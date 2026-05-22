import { NextRequest, NextResponse } from "next/server";
import { createInstance, type ManualProxy } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";
import { chipLog } from "@/lib/logger";

export const maxDuration = 60;

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
      proxy_port: manualProxy?.port,
    });

    // Cria a instancia ja com proxy inline. Sem isso, o Baileys abre o WS para o WhatsApp
    // pelo IP do servidor antes do setup configurar o proxy — causa principal de bans em
    // escala (10-20+ chips pareados pelo mesmo IP).
    const instance = await createInstance(name, number, manualProxy);
    const pairingCode = instance?.qrcode?.pairingCode || null;

    if (!pairingCode) {
      // Loga o response cru da Evolution (sem secrets) para diagnosticar o que veio no lugar do pairing code.
      const safeInstance = instance ? { ...instance } : null;
      if (safeInstance && typeof safeInstance === "object") {
        // Remove campos potencialmente sensiveis antes do log.
        delete (safeInstance as Record<string, unknown>).hash;
        delete (safeInstance as Record<string, unknown>).accessTokenWaBusiness;
      }
      chipLog("error", "chip.connect.no_pairing_code", name, {
        duration_ms: Date.now() - start,
        detail: instance?._firstError ? String(instance._firstError).slice(0, 200) : undefined,
        first_error: instance?._firstError ?? null,
        second_error: instance?._secondError ?? null,
        retried: instance?._retried ?? false,
        recovered_via_poll: instance?._recovered_via_poll ?? false,
        instance_status: instance?.instance?.status,
        instance_response_keys: instance && typeof instance === "object" ? Object.keys(instance).slice(0, 20) : null,
        instance_error_message: instance?.message ?? instance?.error ?? instance?.response?.message ?? null,
        instance_status_code: instance?.status ?? instance?.statusCode ?? null,
        instance_response: JSON.stringify(safeInstance).slice(0, 1500),
      });
      return NextResponse.json(
        { error: "Falha ao gerar codigo de pareamento", instance },
        { status: 500 }
      );
    }

    chipLog("info", "chip.connect.pairing_code_issued", name, {
      duration_ms: Date.now() - start,
      proxy_mode: manualProxy ? "manual" : "auto",
      recovered_via_poll: instance?._recovered_via_poll ?? false,
      retried: instance?._retried ?? false,
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
