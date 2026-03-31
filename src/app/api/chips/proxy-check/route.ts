import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { findProxy } from "@/lib/evolution";
import { checkProxyForInstance } from "@/lib/health";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { name } = await req.json();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const proxyConfig = await findProxy(name);
    const password = proxyConfig?.password;

    const result = await checkProxyForInstance(name, password);
    if (!result) {
      return NextResponse.json(
        { error: "Proxy unreachable", name },
        { status: 502 }
      );
    }

    return NextResponse.json({ name, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: "Proxy check failed", details: String(error) },
      { status: 500 }
    );
  }
}
