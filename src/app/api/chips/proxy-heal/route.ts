import { NextResponse, type NextRequest } from "next/server";
import { requireAuthOrCron } from "@/lib/auth";
import {
  fetchInstances,
  findProxy,
  setProxy,
  getConnectionState,
  restartInstance,
  type ManualProxy,
} from "@/lib/evolution";
import { checkProxyForInstance } from "@/lib/health";

// Roda a cada 30min via Vercel Cron + pode ser triggado manualmente da UI.
// Acoes:
// 1) Chip online SEM proxy enabled  -> aplica MARKETBET (env vars) + restart
// 2) Chip online COM proxy mas teste IP falha:
//    - se manual e nao bate IP esperado -> reaplica MARKETBET + restart
//    - se IPRoyal -> rotaciona session
// 3) Chip reportado open mas getConnectionState diz outra coisa -> restart
//
// MARKETBET vem de env: MARKETBET_PROXY_HOST/PORT/USERNAME/PASSWORD. Sem essas
// envs, healing de orfaos cai pro IPRoyal default (env PROXY_*).

export const maxDuration = 60;

interface HealResult {
  name: string;
  status: "healthy" | "healed" | "orphan_healed" | "restarted" | "unreachable" | "skipped";
  ip?: string;
  city?: string;
  oldSession?: string;
  newSession?: string;
  detail?: string;
}

const STATE_CHECK_CONCURRENCY = 5;
const HEAL_CONCURRENCY = 3;

function getMarketbetProxy(): ManualProxy | null {
  const host = process.env.MARKETBET_PROXY_HOST;
  const port = process.env.MARKETBET_PROXY_PORT;
  const username = process.env.MARKETBET_PROXY_USERNAME;
  const password = process.env.MARKETBET_PROXY_PASSWORD;
  if (!host || !port || !username || !password) return null;
  return { host, port, username, password, protocol: "http" };
}

async function mapBatched<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function healOrphan(name: string, marketbet: ManualProxy | null): Promise<HealResult> {
  // Aplica proxy default (marketbet se env setado, IPRoyal senao).
  try {
    if (marketbet) {
      await setProxy(name, marketbet);
    } else {
      await setProxy(name); // IPRoyal fallback
    }
    // Verifica que persistiu
    await new Promise((r) => setTimeout(r, 400));
    const conf = await findProxy(name);
    if (!conf?.enabled) {
      return { name, status: "unreachable", detail: "proxy not persisted" };
    }
    // Restart pra Baileys reconectar via proxy
    await restartInstance(name);
    // Aguarda + testa
    await new Promise((r) => setTimeout(r, 6000));
    const check = await checkProxyForInstance(name, conf);
    if (check && check.country === "BR") {
      return { name, status: "orphan_healed", ip: check.ip, city: check.city };
    }
    return { name, status: "unreachable", detail: "proxy test failed after heal" };
  } catch (e) {
    return { name, status: "unreachable", detail: String(e).slice(0, 100) };
  }
}

async function handle(req: NextRequest) {
  const denied = await requireAuthOrCron(req);
  if (denied) return denied;

  try {
    const instances = await fetchInstances();
    if (!Array.isArray(instances)) {
      return NextResponse.json({ error: "Failed to fetch instances" }, { status: 500 });
    }

    const marketbet = getMarketbetProxy();
    const reportedOnline = instances.filter(
      (i: Record<string, unknown>) => i.connectionStatus === "open"
    );

    const staleChips: string[] = [];
    const restartedChips: string[] = [];
    const onlineChips: Record<string, unknown>[] = [];

    // Fase 1: verifica estado real (alguns reportam "open" mas Baileys ja caiu)
    await mapBatched(reportedOnline as Record<string, unknown>[], STATE_CHECK_CONCURRENCY, async (chip) => {
      const name = chip.name as string;
      try {
        const state = await getConnectionState(name);
        const actualState = state?.instance?.state || state?.state;
        if (actualState && actualState !== "open") {
          staleChips.push(name);
          try {
            await restartInstance(name);
            restartedChips.push(name);
          } catch { /* silent */ }
        } else {
          onlineChips.push(chip);
        }
      } catch {
        onlineChips.push(chip);
      }
    });

    // Fase 2: pra cada chip realmente online, verifica/heal o proxy
    const results: HealResult[] = await mapBatched(onlineChips, HEAL_CONCURRENCY, async (chip) => {
      const name = chip.name as string;
      const proxy = chip.Proxy as { enabled: boolean } | null;

      // Caso 1: ORFAO — chip sem proxy. Aplica heal proxy + restart.
      if (!proxy?.enabled) {
        return await healOrphan(name, marketbet);
      }

      // Caso 2: tem proxy. Testa se esta funcionando.
      try {
        const proxyConfig = await findProxy(name);
        const check = await checkProxyForInstance(name, proxyConfig);

        if (check && check.country === "BR") {
          return { name, status: "healthy", ip: check.ip, city: check.city };
        }

        // Proxy nao passou no teste. Se for manual, tenta reaplicar marketbet.
        const isIPRoyal = proxyConfig?.host === process.env.PROXY_HOST;

        if (!isIPRoyal) {
          // Manual ou desconhecido — tenta marketbet (ou IPRoyal se nao tem env)
          if (marketbet) {
            await setProxy(name, marketbet);
            await new Promise((r) => setTimeout(r, 400));
            await restartInstance(name);
            await new Promise((r) => setTimeout(r, 6000));
            const newConf = await findProxy(name);
            const recheck = await checkProxyForInstance(name, newConf);
            if (recheck && recheck.country === "BR") {
              return { name, status: "healed", ip: recheck.ip, city: recheck.city };
            }
          }
          return { name, status: "unreachable", detail: "manual proxy failed, heal nao resolveu" };
        }

        // IPRoyal saturado/lento — rotaciona session (setProxy sem args gera nova session)
        const oldPassword = proxyConfig?.password as string | undefined;
        const oldSession = oldPassword?.match(/session-(.+)$/)?.[1] || "unknown";
        await setProxy(name);
        const newConfig = await findProxy(name);
        const newSession = (newConfig?.password as string)?.match(/session-(.+)$/)?.[1] || "unknown";
        const recheck = await checkProxyForInstance(name, newConfig);
        return {
          name,
          status: recheck ? "healed" : "unreachable",
          ip: recheck?.ip,
          city: recheck?.city,
          oldSession,
          newSession,
        };
      } catch (e) {
        return { name, status: "unreachable", detail: String(e).slice(0, 100) };
      }
    });

    const healthy = results.filter((r) => r.status === "healthy").length;
    const healed = results.filter((r) => r.status === "healed").length;
    const orphanHealed = results.filter((r) => r.status === "orphan_healed").length;
    const unreachable = results.filter((r) => r.status === "unreachable").length;

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      total: instances.length,
      online: reportedOnline.length,
      checked: results.length,
      healthy,
      healed,
      orphan_healed: orphanHealed,
      unreachable,
      stale_detected: staleChips,
      restarted: restartedChips,
      marketbet_configured: !!marketbet,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Proxy heal failed", details: String(error).slice(0, 300) },
      { status: 500 }
    );
  }
}

// POST pra trigger manual (NextAuth) ou cron (Bearer CRON_SECRET).
// GET pra Vercel Cron (que usa GET por default).
export const POST = handle;
export const GET = handle;
