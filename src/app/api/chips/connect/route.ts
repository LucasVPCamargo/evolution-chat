import { NextRequest, NextResponse } from "next/server";
import { createInstance, type ManualProxy } from "@/lib/evolution";
import { preCheckManualProxy } from "@/lib/health";
import { requireAuth } from "@/lib/auth";
import { chipLog } from "@/lib/logger";

export const maxDuration = 90;

// Traduz o codigo interno do _firstError em uma mensagem util pro usuario final.
// O createInstance ja loga o detalhe cru; aqui so escolhemos o que aparece no toast.
function userFacingError(detail: string | null | undefined, mode: "manual" | "auto"): string {
  if (!detail) return "Falha ao gerar codigo de pareamento (motivo desconhecido)";
  if (detail.startsWith("set_proxy_failed")) {
    return mode === "manual"
      ? "Proxy manual nao respondeu — confira host:porta:usuario:senha ou troque o IP"
      : "Proxy IPRoyal demorou demais — tente novamente em 30s";
  }
  if (detail === "proxy_not_persisted_after_set") {
    return "Evolution nao salvou o proxy — tente novamente";
  }
  if (detail === "no_pairing_code_after_poll") {
    return "WhatsApp nao respondeu a tempo — pode ser rate-limit do numero (aguarde 10min) ou proxy lento";
  }
  if (detail.startsWith("create_failed")) {
    return "Evolution API offline ou inalcancavel — verifique o pre-check";
  }
  if (detail.startsWith("create_unexpected_response")) {
    return "Evolution retornou resposta inesperada — chip ja existe? tente outro nome";
  }
  return `Falha ao gerar codigo de pareamento (${detail.slice(0, 80)})`;
}

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

    // PRE-CHECK do proxy manual antes de gastar tempo no Evolution. Se o proxy nao
    // responder pela nossa rede, com certeza nao vai responder pra Evolution tambem.
    // Falha rapida (<=12s) com mensagem clara em vez de gastar 25s na validacao
    // interna do Evolution e devolver "set_proxy_failed".
    if (manualProxy) {
      const pc = await preCheckManualProxy(manualProxy);
      if (!pc.ok) {
        chipLog("error", "chip.connect.manual_proxy_unreachable", name, {
          duration_ms: Date.now() - start,
          proxy_host: manualProxy.host,
          proxy_port: manualProxy.port,
          reason: pc.reason,
          probe_ms: pc.latencyMs,
        });
        return NextResponse.json(
          {
            error: "Proxy manual nao respondeu — confira host:porta:usuario:senha ou pegue um IP novo no checker.marketbet.com.br",
            diagnostic: { stage: "pre_check_manual_proxy", reason: pc.reason, probe_ms: pc.latencyMs },
          },
          { status: 502 }
        );
      }
      chipLog("info", "chip.connect.manual_proxy_precheck_ok", name, {
        proxy_host: manualProxy.host,
        proxy_ip: pc.ip,
        proxy_country: pc.country,
        probe_ms: pc.latencyMs,
      });
    }

    // Cria a instancia, configura proxy, dispara Baileys, devolve pairing code.
    // Evolution 2.3.7 ignora `proxy` inline em /instance/create — fluxo correto eh
    // create -> /proxy/set -> /proxy/find -> /instance/connect.
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
        step_durations: instance?._step_durations ?? null,
        total_duration_ms: instance?._total_duration_ms ?? null,
        proxy_mode: manualProxy ? "manual" : "auto",
        instance_status: instance?.instance?.status,
        instance_response_keys: instance && typeof instance === "object" ? Object.keys(instance).slice(0, 20) : null,
        instance_error_message: instance?.message ?? instance?.error ?? instance?.response?.message ?? null,
        instance_status_code: instance?.status ?? instance?.statusCode ?? null,
        instance_response: JSON.stringify(safeInstance).slice(0, 1500),
      });
      return NextResponse.json(
        {
          error: userFacingError(instance?._firstError, manualProxy ? "manual" : "auto"),
          diagnostic: {
            first_error: instance?._firstError ?? null,
            second_error: instance?._secondError ?? null,
            step_durations: instance?._step_durations ?? null,
          },
        },
        { status: 500 }
      );
    }

    chipLog("info", "chip.connect.pairing_code_issued", name, {
      duration_ms: Date.now() - start,
      proxy_mode: manualProxy ? "manual" : "auto",
      recovered_via_poll: instance?._recovered_via_poll ?? false,
      retried: instance?._retried ?? false,
      refreshed: instance?._refreshed ?? false,
      step_durations: instance?._step_durations ?? null,
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
