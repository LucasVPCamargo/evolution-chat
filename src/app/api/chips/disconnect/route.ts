import { NextRequest, NextResponse } from "next/server";
import {
  deleteInstance,
  fetchInstances,
  logoutInstance,
  setChatwoot,
} from "@/lib/evolution";
import { deleteInboxByName } from "@/lib/chatwoot";
import { requireAuth } from "@/lib/auth";

// Maximo budget pra remocao completa: ~22s
// disable_chatwoot ~3s, logout ~6s, wait 1.5s, delete ~4s, inbox cleanup ~5s, verify ~3s
export const maxDuration = 30;

interface StepResult {
  ok: boolean;
  detail?: string;
}

async function safeStep<T>(fn: () => Promise<T>): Promise<StepResult> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 200) };
  }
}

// Sequencia robusta de remocao. Evolution barra delete quando chip esta 'open'
// + Chatwoot integration ativa. Esta sequencia garante remocao mesmo nesses casos:
//   1) Desabilita Chatwoot integration (libera lock)
//   2) Logout (fecha WebSocket Baileys)
//   3) Espera 1.5s pra Evolution processar
//   4) Delete instance (remove do Postgres)
//   5) Em paralelo: limpa inbox Chatwoot
//   6) Verifica via fetchInstances se realmente sumiu
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { name } = (await req.json()) as { name?: string };
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const steps: Record<string, StepResult> = {};

    // 1. Desabilita Chatwoot integration (Evolution as vezes recusa delete sem isso)
    steps.disable_chatwoot = await safeStep(() => setChatwoot(name, false));

    // 2. Logout — fecha o WebSocket do Baileys com o WhatsApp
    steps.logout = await safeStep(() => logoutInstance(name));

    // 3. Pequena espera pra Evolution processar
    await new Promise((r) => setTimeout(r, 1500));

    // 4. Delete instance + 5. cleanup inbox em paralelo
    const [deleteResult, inboxesDeleted] = await Promise.all([
      safeStep(() => deleteInstance(name)),
      deleteInboxByName(name).catch(() => 0),
    ]);
    steps.delete = deleteResult;

    // 6. Se o delete falhou explicitamente (exception), tenta de novo
    if (!steps.delete.ok) {
      await new Promise((r) => setTimeout(r, 1500));
      steps.delete_retry = await safeStep(() => deleteInstance(name));
    }

    // 7. Verify "informativo" — fetchInstances pode ter cache curto, entao
    // a fonte de verdade eh o resultado do delete em si. Verify so adiciona
    // contexto util na resposta, NAO determina sucesso.
    let stillVisible: boolean | null = null;
    try {
      // Pequeno wait extra pra cache propagar
      await new Promise((r) => setTimeout(r, 1000));
      const list = await fetchInstances();
      stillVisible = Array.isArray(list) && list.some((i: { name: string }) => i.name === name);
    } catch {
      stillVisible = null;
    }

    const deleteOk = steps.delete.ok === true || steps.delete_retry?.ok === true;

    return NextResponse.json(
      {
        ok: deleteOk,
        name,
        inboxes_deleted: inboxesDeleted,
        still_visible_after_delete: stillVisible, // informativo (cache?)
        steps,
      },
      { status: deleteOk ? 200 : 500 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to disconnect chip", details: String(error).slice(0, 300) },
      { status: 500 }
    );
  }
}
