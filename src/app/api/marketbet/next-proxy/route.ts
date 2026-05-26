import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { generateProxy, formatProxyString } from "@/lib/marketbet";

// Gera 1 proxy fresh da API marketbet. Usado pelo ConnectModal pra pre-preencher
// o campo manual com proxy unico por chip novo (em vez de todos compartilharem
// 74.81.81.81:823 hardcoded).
export const maxDuration = 20;

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const proxy = await generateProxy({ tipo: "fixo", country: "br" });
    return NextResponse.json({
      ...proxy,
      formatted: formatProxyString(proxy),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Falha ao gerar proxy marketbet", details: String(e).slice(0, 300) },
      { status: 502 }
    );
  }
}
