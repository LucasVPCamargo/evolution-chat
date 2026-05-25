import { NextRequest, NextResponse } from "next/server";
import { createInstance, type ManualProxy } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";
import { chipLog } from "@/lib/logger";

// Fluxo confirmado em producao (deploy AmjndGdRE de 8/5 que funcionava): connect
// devolve o pairing code direto, em 2-3s. Proxy e Chatwoot sao configurados depois
// pelo /api/chips/setup quando o user clica "Pronto, Conectei!".
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const start = Date.now();
  let chipName: string | null = null;

  try {
    const { name, number, manualProxy } = (await req.json()) as {
      name?: string;
      number?: string;
      manualProxy?: ManualProxy;
    };
    chipName = name ?? null;

    if (!name || !number) {
      chipLog("warn", "chip.connect.invalid_payload", chipName, { reason: "missing_name_or_number" });
      return NextResponse.json({ error: "name and number are required" }, { status: 400 });
    }

    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      chipLog("warn", "chip.connect.invalid_payload", chipName, { reason: "invalid_name_format" });
      return NextResponse.json(
        { error: "nome invalido: use apenas letras, numeros, _ ou - (sem espacos)" },
        { status: 400 }
      );
    }

    chipLog("info", "chip.connect.requested", name, {
      number,
      proxy_mode: manualProxy ? "manual" : "auto",
      proxy_host: manualProxy?.host,
    });

    // POST /instance/create { qrcode: true } devolve pairing code direto.
    // manualProxy e ignorado aqui — sera usado pelo /api/chips/setup depois.
    const instance = await createInstance(name, number, manualProxy);
    const pairingCode = instance?.qrcode?.pairingCode || null;

    if (!pairingCode) {
      chipLog("error", "chip.connect.no_pairing_code", name, {
        duration_ms: Date.now() - start,
        instance_status: instance?.instance?.status,
        instance_error_message: instance?.message ?? instance?.error ?? instance?.response?.message ?? null,
        instance_response: JSON.stringify(instance).slice(0, 800),
      });
      return NextResponse.json(
        { error: "Falha ao gerar codigo de pareamento", instance },
        { status: 500 }
      );
    }

    chipLog("info", "chip.connect.pairing_code_issued", name, {
      duration_ms: Date.now() - start,
      proxy_mode: manualProxy ? "manual" : "auto",
    });

    return NextResponse.json({ pairingCode });
  } catch (error) {
    chipLog("error", "chip.connect.failed", chipName, {
      duration_ms: Date.now() - start,
      detail: String(error).slice(0, 300),
    });
    return NextResponse.json(
      { error: "Failed to connect chip", details: String(error) },
      { status: 500 }
    );
  }
}
