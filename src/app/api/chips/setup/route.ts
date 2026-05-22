import { NextRequest, NextResponse } from "next/server";
import { setChatwoot, setSettings, type ManualProxy } from "@/lib/evolution";
import { createInbox, addAllAgentsToInbox } from "@/lib/chatwoot";
import { requireAuth } from "@/lib/auth";

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

  try {
    const { name, manualProxy } = (await req.json()) as {
      name?: string;
      manualProxy?: ManualProxy;
    };

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // O proxy ja foi configurado no /api/chips/connect (inline no instance/create).
    // Aqui so cuidamos do redsocks-exclude (manual) e do Chatwoot/settings.
    if (manualProxy?.host) {
      await fetch(
        `${process.env.EVOLUTION_API_URL!.replace(":8080", ":9090")}/exclude/${manualProxy.host}`,
        { signal: AbortSignal.timeout(5000) }
      ).catch(() => null);
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

    return NextResponse.json({
      status: warnings.length === 0 ? "ok" : "partial",
      warnings,
      inbox: inboxResult.ok ? inboxResult.value : null,
      chatwoot: chatwootResult.ok ? chatwootResult.value : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to setup chip", details: String(error) },
      { status: 500 }
    );
  }
}
