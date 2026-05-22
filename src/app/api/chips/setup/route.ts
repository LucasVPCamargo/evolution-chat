import { NextRequest, NextResponse } from "next/server";
import { setChatwoot, setSettings, type ManualProxy } from "@/lib/evolution";
import { createInbox, addAllAgentsToInbox } from "@/lib/chatwoot";
import { requireAuth } from "@/lib/auth";
import { chipLog } from "@/lib/logger";

export const maxDuration = 15;

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

    // O proxy ja foi configurado no /api/chips/connect (inline no instance/create).
    // Aqui so cuidamos do redsocks-exclude (manual) e do Chatwoot/settings.
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

    const [inboxResult, settingsResult] = await Promise.all([
      safe("inbox", () => createInbox(name)),
      safe("settings", () => setSettings(name)),
    ]);

    let agentsResult: Awaited<ReturnType<typeof safe>> | null = null;
    if (inboxResult.ok && (inboxResult.value as { id?: number })?.id) {
      const inboxId = (inboxResult.value as { id: number }).id;
      agentsResult = await safe("agents", () => addAllAgentsToInbox(inboxId));
    }

    const chatwootResult = await safe("chatwoot", () => setChatwoot(name));

    const results = [inboxResult, settingsResult, agentsResult, chatwootResult].filter(
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
