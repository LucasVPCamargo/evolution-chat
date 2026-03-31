import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchInstances, findProxy, setProxy } from "@/lib/evolution";
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

    const onlineChips = instances.filter(
      (i: Record<string, unknown>) => i.connectionStatus === "open"
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
          const oldPassword = proxyConfig?.password as string | undefined;

          const check = await checkProxyForInstance(name, oldPassword);

          if (check) {
            return {
              name,
              status: "healthy" as const,
              ip: check.ip,
              city: check.city,
            };
          }

          // Proxy morto - reconfigura com nova sessao
          const oldSession = oldPassword?.match(/session-(.+)$/)?.[1] || "unknown";
          await setProxy(name);
          const newConfig = await findProxy(name);
          const newSession = (newConfig?.password as string)?.match(/session-(.+)$/)?.[1] || "unknown";

          // Verifica se a nova sessao funciona
          const recheck = await checkProxyForInstance(name, newConfig?.password as string);

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
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Proxy heal failed", details: String(error) },
      { status: 500 }
    );
  }
}
