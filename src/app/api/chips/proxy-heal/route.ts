import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchInstances, findProxy, setProxy, getConnectionState, restartInstance } from "@/lib/evolution";
import { checkProxyForInstance } from "@/lib/health";

interface HealResult {
  name: string;
  status: "healthy" | "healed" | "unreachable" | "skipped";
  ip?: string;
  city?: string;
  oldSession?: string;
  newSession?: string;
}

export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const instances = await fetchInstances();
    if (!Array.isArray(instances)) {
      return NextResponse.json({ error: "Failed to fetch instances" }, { status: 500 });
    }

    // Verificar estado real dos chips que Evolution reporta como "open"
    const reportedOnline = instances.filter(
      (i: Record<string, unknown>) => i.connectionStatus === "open"
    );

    const staleChips: string[] = [];
    const restartedChips: string[] = [];
    const onlineChips: Record<string, unknown>[] = [];

    await Promise.all(
      reportedOnline.map(async (chip: Record<string, unknown>) => {
        const name = chip.name as string;
        try {
          const state = await getConnectionState(name);
          const actualState = state?.instance?.state || state?.state;
          if (actualState && actualState !== "open") {
            staleChips.push(name);
            // Tentar restart automático para reconectar
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
      })
    );

    const results: HealResult[] = await Promise.all(
      onlineChips.map(async (chip: Record<string, unknown>) => {
        const name = chip.name as string;
        const proxy = chip.Proxy as { enabled: boolean } | null;

        if (!proxy?.enabled) {
          return { name, status: "skipped" as const };
        }

        try {
          const proxyConfig = await findProxy(name);

          const check = await checkProxyForInstance(name, proxyConfig);

          if (check) {
            return {
              name,
              status: "healthy" as const,
              ip: check.ip,
              city: check.city,
            };
          }

          // Proxy manual nao deve ser auto-healado (nao temos pool de proxies manuais)
          const isManualProxy = proxyConfig?.host !== process.env.PROXY_HOST;
          if (isManualProxy) {
            return { name, status: "unreachable" as const };
          }

          // Proxy IPRoyal morto - reconfigura com nova sessao
          const oldPassword = proxyConfig?.password as string | undefined;
          const oldSession = oldPassword?.match(/session-(.+)$/)?.[1] || "unknown";
          await setProxy(name);
          const newConfig = await findProxy(name);
          const newSession = (newConfig?.password as string)?.match(/session-(.+)$/)?.[1] || "unknown";

          // Verifica se a nova sessao funciona
          const recheck = await checkProxyForInstance(name, newConfig);

          return {
            name,
            status: recheck ? "healed" as const : "unreachable" as const,
            ip: recheck?.ip,
            city: recheck?.city,
            oldSession,
            newSession,
          };
        } catch {
          return { name, status: "unreachable" as const };
        }
      })
    );

    const healed = results.filter((r) => r.status === "healed").length;
    const healthy = results.filter((r) => r.status === "healthy").length;
    const unreachable = results.filter((r) => r.status === "unreachable").length;

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      checked: results.length,
      healthy,
      healed,
      unreachable,
      staleDetected: staleChips,
      restartedChips,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Proxy heal failed", details: String(error) },
      { status: 500 }
    );
  }
}
