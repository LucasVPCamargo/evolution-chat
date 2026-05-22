import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchInstances, findProxy, setProxy, getConnectionState, restartInstance } from "@/lib/evolution";
import { checkProxyForInstance } from "@/lib/health";
import { chipLog } from "@/lib/logger";

interface HealResult {
  name: string;
  status: "healthy" | "healed" | "restarted" | "unreachable" | "skipped";
  ip?: string;
  city?: string;
  oldSession?: string;
  newSession?: string;
}

const STATE_CHECK_CONCURRENCY = 5;
const HEAL_CONCURRENCY = 3;

async function mapBatched<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
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

export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  const cycleStart = Date.now();

  try {
    const instances = await fetchInstances();
    if (!Array.isArray(instances)) {
      chipLog("error", "proxy.heal.fetch_instances_failed", null, {});
      return NextResponse.json({ error: "Failed to fetch instances" }, { status: 500 });
    }

    const reportedOnline = instances.filter(
      (i: Record<string, unknown>) => i.connectionStatus === "open"
    );

    chipLog("info", "proxy.heal.cycle.started", null, {
      total_instances: instances.length,
      reported_online: reportedOnline.length,
    });

    const staleChips: string[] = [];
    const restartedChips: string[] = [];
    const onlineChips: Record<string, unknown>[] = [];

    await mapBatched(
      reportedOnline as Record<string, unknown>[],
      STATE_CHECK_CONCURRENCY,
      async (chip) => {
        const name = chip.name as string;
        try {
          const state = await getConnectionState(name);
          const actualState = state?.instance?.state || state?.state;
          if (actualState && actualState !== "open") {
            staleChips.push(name);
            chipLog("warn", "proxy.heal.chip.stale_detected", name, { actual_state: actualState });
            try {
              await restartInstance(name);
              restartedChips.push(name);
              chipLog("info", "proxy.heal.chip.stale_restarted", name, {});
            } catch (e) {
              chipLog("error", "proxy.heal.chip.stale_restart_failed", name, { detail: String(e).slice(0, 200) });
            }
          } else {
            onlineChips.push(chip);
          }
        } catch (e) {
          chipLog("warn", "proxy.heal.chip.state_check_failed", name, { detail: String(e).slice(0, 200) });
          onlineChips.push(chip);
        }
      },
    );

    const results: HealResult[] = await mapBatched(
      onlineChips,
      HEAL_CONCURRENCY,
      async (chip) => {
        const name = chip.name as string;
        const proxy = chip.Proxy as { enabled: boolean } | null;

        if (!proxy?.enabled) {
          chipLog("info", "proxy.heal.chip.skipped_no_proxy", name, {});
          return { name, status: "skipped" as const };
        }

        try {
          const proxyConfig = await findProxy(name);
          const check = await checkProxyForInstance(name, proxyConfig);

          if (check) {
            chipLog("info", "proxy.heal.chip.healthy", name, {
              proxy_host: proxyConfig?.host,
              proxy_ip: check.ip,
              proxy_city: check.city,
              proxy_country: check.country,
              duration_ms: check.latencyMs,
            });
            return { name, status: "healthy" as const, ip: check.ip, city: check.city };
          }

          const isManualProxy = proxyConfig?.host !== process.env.PROXY_HOST;
          if (isManualProxy) {
            chipLog("warn", "proxy.heal.chip.manual_unreachable", name, { proxy_host: proxyConfig?.host });
            try {
              await restartInstance(name);
              chipLog("info", "proxy.heal.chip.restarted", name, { proxy_host: proxyConfig?.host });
              return { name, status: "restarted" as const, ip: proxyConfig?.host };
            } catch (e) {
              chipLog("error", "proxy.heal.chip.restart_failed", name, {
                proxy_host: proxyConfig?.host,
                detail: String(e).slice(0, 200),
              });
              return { name, status: "unreachable" as const };
            }
          }

          const oldPassword = proxyConfig?.password as string | undefined;
          const oldSession = oldPassword?.match(/session-(.+)$/)?.[1] || "unknown";

          chipLog("info", "proxy.heal.chip.rotating_session", name, { old_session: oldSession });
          await setProxy(name);
          const newConfig = await findProxy(name);
          const newSession = (newConfig?.password as string)?.match(/session-(.+)$/)?.[1] || "unknown";

          const recheck = await checkProxyForInstance(name, newConfig);

          if (recheck) {
            chipLog("info", "proxy.heal.chip.healed", name, {
              old_session: oldSession,
              new_session: newSession,
              proxy_ip: recheck.ip,
              proxy_city: recheck.city,
            });
            return { name, status: "healed" as const, ip: recheck.ip, city: recheck.city, oldSession, newSession };
          }

          chipLog("warn", "proxy.heal.chip.heal_failed", name, {
            old_session: oldSession,
            new_session: newSession,
          });
          return { name, status: "unreachable" as const, oldSession, newSession };
        } catch (e) {
          chipLog("error", "proxy.heal.chip.error", name, { detail: String(e).slice(0, 200) });
          return { name, status: "unreachable" as const };
        }
      },
    );

    const healed = results.filter((r) => r.status === "healed").length;
    const healthy = results.filter((r) => r.status === "healthy").length;
    const restarted = results.filter((r) => r.status === "restarted").length;
    const unreachable = results.filter((r) => r.status === "unreachable").length;

    chipLog("info", "proxy.heal.cycle.completed", null, {
      duration_ms: Date.now() - cycleStart,
      checked: results.length,
      healthy,
      healed,
      restarted,
      unreachable,
      stale_detected: staleChips.length,
      stale_restarted: restartedChips.length,
    });

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      checked: results.length,
      healthy,
      healed,
      restarted,
      unreachable,
      staleDetected: staleChips,
      restartedChips,
      results,
    });
  } catch (error) {
    chipLog("error", "proxy.heal.cycle.failed", null, {
      duration_ms: Date.now() - cycleStart,
      detail: String(error).slice(0, 300),
    });
    return NextResponse.json(
      { error: "Proxy heal failed", details: String(error) },
      { status: 500 }
    );
  }
}
