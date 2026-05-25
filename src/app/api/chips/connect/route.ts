import { NextRequest, NextResponse } from "next/server";
import { createInstance } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";

export const maxDuration = 15;

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

    // Step 1: Create instance — returns pairing code immediately
    const instance = await createInstance(name, number);
    const pairingCode = instance?.qrcode?.pairingCode || null;

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
