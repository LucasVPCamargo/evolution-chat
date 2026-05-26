import { NextResponse, type NextRequest } from "next/server";
import { requireAuthOrCron } from "@/lib/auth";
import {
  fetchInstances,
  findProxy,
  setProxy,
  getConnectionState,
  restartInstance,
  setChatwoot,
  type ManualProxy,
} from "@/lib/evolution";
import { checkProxyForInstance } from "@/lib/health";
import { generateProxy } from "@/lib/marketbet";
import {
  createInbox,
  deleteInbox,
  listInboxes,
  addAllAgentsToInbox,
  resolveWmiConversations,
} from "@/lib/chatwoot";

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

async function healOrphan(name: string, marketbetEnv: ManualProxy | null): Promise<HealResult> {
  try {
    // Preferencia: API marketbet (proxy dedicado fresh). Fallback: env hardcoded.
    let proxy: ManualProxy;
    try {
      const fresh = await generateProxy({ tipo: "fixo", country: "br" });
      proxy = {
        host: fresh.host,
        port: fresh.port,
        username: fresh.username,
        password: fresh.password,
        protocol: fresh.protocol,
      };
    } catch {
      if (!marketbetEnv) {
        return { name, status: "unreachable", detail: "marketbet API failed e nao tem env fallback" };
      }
      proxy = marketbetEnv;
    }

    await setProxy(name, proxy);
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

    // ============================================================
    // FASE 4: Cleanup de inboxes Chatwoot (Fase nova!)
    // - Inbox de chip em close            -> disable integration + delete inbox
    // - Inbox orfa (chip nao existe)       -> delete inbox
    // - Chip online sem inbox              -> criar inbox + integrar Chatwoot
    // Tudo idempotente, seguro pra rodar varias vezes.
    // ============================================================
    const inboxCleanup = {
      orphans_deleted: [] as string[],
      close_inboxes_deleted: [] as string[],
      duplicates_deleted: [] as { chip: string; kept_id: number; deleted_ids: number[] }[],
      inboxes_recreated: [] as string[],
      wmi_resolved: [] as { chip: string; resolved: number; checked: number }[],
      errors: [] as { name: string; step: string; error: string }[],
    };

    try {
      const inboxData = await listInboxes();
      const allInboxes = (inboxData.payload ?? inboxData ?? []) as Array<{ id: number; name: string }>;
      // Agrupa inboxes por chipName, pra detectar duplicatas (mesmo chip com varias inboxes)
      const inboxesByChip = new Map<string, Array<{ id: number; name: string }>>();
      for (const inb of allInboxes) {
        const m = (inb.name || "").match(/^WhatsApp\s*-\s*(.+)$/);
        if (!m) continue;
        const chipName = m[1].trim();
        if (!inboxesByChip.has(chipName)) inboxesByChip.set(chipName, []);
        inboxesByChip.get(chipName)!.push(inb);
      }

      // Dedup: mantem inbox com maior id (mais nova) e deleta as outras
      const inboxMap = new Map<string, { id: number; name: string }>();
      for (const [chipName, list] of inboxesByChip) {
        if (list.length === 1) {
          inboxMap.set(chipName, list[0]);
          continue;
        }
        // 2+ inboxes mesmo chip — keep newest (highest id)
        list.sort((a, b) => b.id - a.id);
        const kept = list[0];
        const toDelete = list.slice(1);
        const deletedIds: number[] = [];
        for (const inb of toDelete) {
          try {
            await deleteInbox(inb.id);
            deletedIds.push(inb.id);
          } catch (e) {
            inboxCleanup.errors.push({ name: chipName, step: "delete_duplicate", error: String(e).slice(0, 100) });
          }
        }
        if (deletedIds.length > 0) {
          inboxCleanup.duplicates_deleted.push({ chip: chipName, kept_id: kept.id, deleted_ids: deletedIds });
        }
        inboxMap.set(chipName, kept);
      }

      const chipsByName = new Map<string, Record<string, unknown>>();
      for (const c of instances as Record<string, unknown>[]) {
        chipsByName.set(c.name as string, c);
      }

      // 1. Delete orfa inboxes (chip nao existe na Evolution)
      for (const [chipName, inb] of inboxMap) {
        if (!chipsByName.has(chipName)) {
          try {
            await deleteInbox(inb.id);
            inboxCleanup.orphans_deleted.push(chipName);
            inboxMap.delete(chipName);
          } catch (e) {
            inboxCleanup.errors.push({ name: chipName, step: "delete_orphan", error: String(e).slice(0, 100) });
          }
        }
      }

      // 2. Delete inboxes de chips em close (com disable integration antes)
      for (const [chipName, chip] of chipsByName) {
        if (chip.connectionStatus !== "close") continue;
        const inb = inboxMap.get(chipName);
        if (!inb) continue;
        try {
          // Disable integration primeiro pra Evolution parar de postar
          await setChatwoot(chipName, false);
        } catch (e) {
          inboxCleanup.errors.push({ name: chipName, step: "disable_chatwoot", error: String(e).slice(0, 100) });
        }
        try {
          await deleteInbox(inb.id);
          inboxCleanup.close_inboxes_deleted.push(chipName);
          inboxMap.delete(chipName);
        } catch (e) {
          inboxCleanup.errors.push({ name: chipName, step: "delete_close_inbox", error: String(e).slice(0, 100) });
        }
      }

      // 3. Chips online sem inbox -> recriar
      for (const chip of onlineChips) {
        const chipName = chip.name as string;
        if (inboxMap.has(chipName)) continue;
        try {
          const inboxResult = await createInbox(chipName);
          const inboxId = (inboxResult as { id?: number })?.id;
          if (!inboxId) {
            inboxCleanup.errors.push({ name: chipName, step: "create_inbox", error: "no id returned" });
            continue;
          }
          // Adiciona todos agentes
          try { await addAllAgentsToInbox(inboxId); } catch { /* nao critico */ }
          // Re-habilita Chatwoot integration na Evolution apontando pra nova inbox
          await setChatwoot(chipName, true);
          inboxCleanup.inboxes_recreated.push(chipName);
          inboxMap.set(chipName, { id: inboxId, name: `WhatsApp - ${chipName}` });
        } catch (e) {
          inboxCleanup.errors.push({ name: chipName, step: "recreate_inbox", error: String(e).slice(0, 100) });
        }
      }

      // 4. Resolve conversas WMI (maturador de chips) em cada inbox ativo
      for (const [chipName, inb] of inboxMap) {
        try {
          const res = await resolveWmiConversations(inb.id);
          if (res.resolved > 0) {
            inboxCleanup.wmi_resolved.push({ chip: chipName, resolved: res.resolved, checked: res.checked });
          }
        } catch (e) {
          inboxCleanup.errors.push({ name: chipName, step: "wmi_resolve", error: String(e).slice(0, 100) });
        }
      }
    } catch (e) {
      inboxCleanup.errors.push({ name: "_general", step: "inbox_cleanup", error: String(e).slice(0, 200) });
    }

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
      inbox_cleanup: inboxCleanup,
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
// Next.js exige function declarations nomeadas, n\xC3\xA3o alias via const.
export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}
