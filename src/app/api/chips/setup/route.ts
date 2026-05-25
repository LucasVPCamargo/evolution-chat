import { NextRequest, NextResponse } from "next/server";
import { restartInstance, setChatwoot, setProxy, setSettings, type ManualProxy } from "@/lib/evolution";
import { createInbox, addAllAgentsToInbox } from "@/lib/chatwoot";
import { requireAuth } from "@/lib/auth";
import { chipLog } from "@/lib/logger";

export const maxDuration = 20;

// Tenta a tarefa e devolve { ok: true, value } ou { ok: false, error }. Sem mais .catch(() => null)
// engolindo falhas silenciosamente — o cliente recebe o detalhe do que deu errado.
async function safe<T>(label: string, fn: () => Promise<T>): Promise<
  { ok: true; label: string; value: T } | { ok: false; label: string; error: string }
> {
  try {
    return { ok: true, label, value: await fn() };
  } catch (e) {
    return { ok: false, label, error: String(e).slice(0, 300) };
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const start = Date.now();
  let chipName: string | null = null;

  try {
    const { name, manualProxy } = (await req.json()) as {
      name?: string;
      manualProxy?: ManualProxy;
    };
    chipName = name ?? null;

    if (!name) {
      chipLog("warn", "chip.setup.invalid_payload", chipName, { reason: "missing_name" });
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    chipLog("info", "chip.setup.started", name, {
      proxy_mode: manualProxy ? "manual" : "auto",
      proxy_host: manualProxy?.host,
    });

    // Para proxy manual, exclui o IP do redsocks antes de configurar.
    if (manualProxy?.host) {
      await fetch(
        `${process.env.EVOLUTION_API_URL!.replace(":8080", ":9090")}/exclude/${manualProxy.host}`,
        { signal: AbortSignal.timeout(5000) }
      ).catch((e) => {
        chipLog("warn", "chip.setup.redsocks_exclude_failed", name, {
          proxy_host: manualProxy.host,
          detail: String(e).slice(0, 200),
        });
        return null;
      });
    }

    // Setup roda APOS o pairing — momento certo de configurar proxy + Chatwoot.
    // Tudo em paralelo, cada um isolado (falha de um nao bloqueia os outros).
    const [proxyResult, inboxResult, settingsResult] = await Promise.all([
      safe("proxy", () => setProxy(name, manualProxy)),
      safe("inbox", () => createInbox(name)),
      safe("settings", () => setSettings(name)),
    ]);

    let agentsResult: Awaited<ReturnType<typeof safe>> | null = null;
    if (inboxResult.ok && (inboxResult.value as { id?: number })?.id) {
      const inboxId = (inboxResult.value as { id: number }).id;
      agentsResult = await safe("agents", () => addAllAgentsToInbox(inboxId));
    }

    const chatwootResult = await safe("chatwoot", () => setChatwoot(name));

    // RESTART pra forcar o Baileys a reconectar ja lendo o proxy persistido no DB.
    // Sem isso, o WebSocket do pareamento inicial continua sendo usado por sessoes
    // — vazando IP do servidor pro WhatsApp por minutos/horas. So vale rodar se
    // o proxy realmente foi persistido (proxyResult.ok). Pequeno sleep pra deixar
    // Baileys terminar de sincronizar a sessao recem-pareada antes do restart.
    let restartResult: Awaited<ReturnType<typeof safe>> | null = null;
    if (proxyResult.ok) {
      await new Promise((r) => setTimeout(r, 1500));
      restartResult = await safe("restart", () => restartInstance(name));
    } else {
      chipLog("warn", "chip.setup.restart_skipped", name, { reason: "proxy_not_set" });
    }

    const results = [proxyResult, inboxResult, settingsResult, agentsResult, chatwootResult, restartResult].filter(
      (r): r is NonNullable<typeof r> => r !== null,
    );
    const warnings = results.filter((r) => !r.ok).map((r) => ({ step: r.label, error: r.error }));

    // Log de cada step que falhou.
    for (const w of warnings) {
      chipLog("warn", `chip.setup.${w.step}_failed`, name, { detail: w.error });
    }

    chipLog("info", "chip.setup.completed", name, {
      duration_ms: Date.now() - start,
      status: warnings.length === 0 ? "ok" : "partial",
      warning_count: warnings.length,
      proxy_applied_via_restart: proxyResult.ok && restartResult?.ok === true,
    });

    return NextResponse.json({
      status: warnings.length === 0 ? "ok" : "partial",
      warnings,
      inbox: inboxResult.ok ? inboxResult.value : null,
      chatwoot: chatwootResult.ok ? chatwootResult.value : null,
    });
  } catch (error) {
    chipLog("error", "chip.setup.failed", chipName, {
      duration_ms: Date.now() - start,
      detail: String(error).slice(0, 300),
    });
    return NextResponse.json(
      { error: "Failed to setup chip", details: String(error) },
      { status: 500 }
    );
  }
}
