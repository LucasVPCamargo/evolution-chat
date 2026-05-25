import { NextRequest, NextResponse } from "next/server";
import { connectInstance, createInstance } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { name, number } = await req.json();

    if (!name || !number) {
      return NextResponse.json(
        { error: "name and number are required" },
        { status: 400 }
      );
    }

    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      return NextResponse.json(
        { error: "nome invalido: use apenas letras, numeros, _ ou - (sem espacos)" },
        { status: 400 }
      );
    }

    // Step 1: Create instance — returns pairing code immediately (na maioria das vezes)
    const instance = await createInstance(name, number);
    let pairingCode = instance?.qrcode?.pairingCode || null;

    // Step 2 (fallback): as vezes Baileys ainda esta inicializando quando /create
    // responde, e qrcode.pairingCode vem null. Espera 2.5s e tenta pegar via
    // /instance/connect — o code costuma estar disponivel ai.
    if (!pairingCode) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const c = await connectInstance(name);
        pairingCode = c?.pairingCode || null;
      } catch { /* ignore — vai cair no erro abaixo */ }
    }

    if (!pairingCode) {
      return NextResponse.json(
        { error: "Falha ao gerar codigo de pareamento", instance },
        { status: 500 }
      );
    }

    // Return pairing code ASAP — proxy/chatwoot configured via /api/chips/setup
    return NextResponse.json({ pairingCode });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to connect chip", details: String(error) },
      { status: 500 }
    );
  }
}
