import { NextRequest, NextResponse } from "next/server";
import { createInstance, type ManualProxy } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";

export const maxDuration = 20;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { name, number, manualProxy } = (await req.json()) as {
      name?: string;
      number?: string;
      manualProxy?: ManualProxy;
    };

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

    // Cria a instancia ja com proxy inline. Sem isso, o Baileys abre o WS para o WhatsApp
    // pelo IP do servidor antes do setup configurar o proxy — causa principal de bans em
    // escala (10-20+ chips pareados pelo mesmo IP).
    const instance = await createInstance(name, number, manualProxy);
    const pairingCode = instance?.qrcode?.pairingCode || null;

    if (!pairingCode) {
      return NextResponse.json(
        { error: "Falha ao gerar codigo de pareamento", instance },
        { status: 500 }
      );
    }

    // Chatwoot/settings sao configurados via /api/chips/setup depois do pareamento.
    return NextResponse.json({ pairingCode });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to connect chip", details: String(error) },
      { status: 500 }
    );
  }
}
