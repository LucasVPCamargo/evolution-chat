import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { findProxy } from "@/lib/evolution";
import { checkProxyForInstance } from "@/lib/health";
import { chipLog } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const start = Date.now();
  let chipName: string | null = null;

  try {
    const { name } = await req.json();
    chipName = name ?? null;
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const proxyConfig = await findProxy(name);
    const result = await checkProxyForInstance(name, proxyConfig);

    if (!result) {
      chipLog("warn", "proxy.check.unreachable", name, {
        duration_ms: Date.now() - start,
        proxy_host: proxyConfig?.host,
      });
      return NextResponse.json({ error: "Proxy unreachable", name }, { status: 502 });
    }

    chipLog("info", "proxy.check.ok", name, {
      duration_ms: Date.now() - start,
      proxy_host: proxyConfig?.host,
      proxy_ip: result.ip,
      proxy_city: result.city,
      proxy_country: result.country,
    });

    return NextResponse.json({ name, ...result });
  } catch (error) {
    chipLog("error", "proxy.check.failed", chipName, {
      duration_ms: Date.now() - start,
      detail: String(error).slice(0, 300),
    });
    return NextResponse.json(
      { error: "Proxy check failed", details: String(error) },
      { status: 500 }
    );
  }
}
