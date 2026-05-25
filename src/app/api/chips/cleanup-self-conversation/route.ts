import { NextRequest, NextResponse } from "next/server";
import { findInboxByName, resolveSelfConversations } from "@/lib/chatwoot";
import { requireAuth } from "@/lib/auth";

// Resolve automaticamente as conversas que o WhatsApp cria pro proprio numero do
// chip logo apos o pareamento (notificacao "device linked"). Sem isso, todo chip
// novo deixa 1 conversa aberta na inbox poluindo a visao de atendimento.
//
// Faz ate 3 tentativas espacadas (a msg pode demorar 5-15s pra aparecer no Chatwoot).
// Pior caso de execucao: ~12s. maxDuration 20s pra folga.
export const maxDuration = 20;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { name, number } = await req.json();
    if (!name || !number) {
      return NextResponse.json({ error: "name and number are required" }, { status: 400 });
    }

    const inbox = await findInboxByName(name);
    if (!inbox) {
      return NextResponse.json({ resolved: 0, checked: 0, reason: "inbox_not_found" });
    }

    const result = await resolveSelfConversations(inbox.id, number, 3, 4000);
    return NextResponse.json({ inboxId: inbox.id, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: "cleanup failed", details: String(error).slice(0, 300) },
      { status: 500 }
    );
  }
}
