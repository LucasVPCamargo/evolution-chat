import { NextResponse, type NextRequest } from "next/server";
import { requireAuthOrCron } from "@/lib/auth";
import { listInboxes, resolveWmiConversations } from "@/lib/chatwoot";
import { log } from "@/lib/log";

// Resolve conversas WMI (maturador) em todas as inboxes WhatsApp.
// Extraido do proxy-heal pra reduzir budget do heal (era Phase 4.4) e poder
// rodar em frequencia diferente (30min vs 15min do heal).
//
// NAO toca em nenhum chip Baileys — so faz calls de Chatwoot. Seguro pra rodar
// em paralelo com heal.
export const maxDuration = 60;

async function handle(req: NextRequest) {
  const denied = await requireAuthOrCron(req);
  if (denied) return denied;

  const start = Date.now();
  log("wmi.cycle_start", {});

  const result = {
    inboxes_processed: 0,
    total_resolved: 0,
    total_checked: 0,
    by_inbox: [] as Array<{ chip: string; resolved: number; checked: number }>,
    errors: [] as Array<{ chip: string; error: string }>,
  };

  try {
    const inboxData = await listInboxes();
    const allInboxes = (inboxData.payload ?? inboxData ?? []) as Array<{ id: number; name: string }>;
    const waInboxes = allInboxes.filter((i) => /^WhatsApp\s*-\s*/.test(i.name || ""));

    for (const inb of waInboxes) {
      const chipName = (inb.name || "").replace(/^WhatsApp\s*-\s*/, "").trim();
      try {
        const r = await resolveWmiConversations(inb.id);
        result.inboxes_processed++;
        result.total_resolved += r.resolved;
        result.total_checked += r.checked;
        if (r.resolved > 0) {
          result.by_inbox.push({ chip: chipName, resolved: r.resolved, checked: r.checked });
          log("wmi.resolved", { chip: chipName, resolved: r.resolved, checked: r.checked });
        }
      } catch (e) {
        const error = String(e).slice(0, 200);
        result.errors.push({ chip: chipName, error });
        log("wmi.error", { chip: chipName, error });
      }
    }

    log("wmi.cycle_done", {
      duration_ms: Date.now() - start,
      inboxes: result.inboxes_processed,
      resolved: result.total_resolved,
      checked: result.total_checked,
      errors: result.errors.length,
    });

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - start,
      ...result,
    });
  } catch (e) {
    log("wmi.fatal", { error: String(e).slice(0, 300) });
    return NextResponse.json({ error: "WMI resolve failed", details: String(e).slice(0, 300) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}
