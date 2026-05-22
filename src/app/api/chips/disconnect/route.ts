import { NextRequest, NextResponse } from "next/server";
import { deleteInstance } from "@/lib/evolution";
import { deleteInboxByName } from "@/lib/chatwoot";
import { requireAuth } from "@/lib/auth";
import { chipLog } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const start = Date.now();
  let chipName: string | null = null;

  try {
    const { name } = await req.json();
    chipName = name ?? null;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    chipLog("info", "chip.disconnect.requested", name, {});

    const [result, inboxesDeleted] = await Promise.all([
      deleteInstance(name),
      deleteInboxByName(name).catch((e) => {
        chipLog("warn", "chip.disconnect.inbox_delete_failed", name, { detail: String(e).slice(0, 200) });
        return 0;
      }),
    ]);

    chipLog("info", "chip.disconnect.completed", name, {
      duration_ms: Date.now() - start,
      inboxes_deleted: inboxesDeleted,
    });

    return NextResponse.json({ ...result, inboxesDeleted });
  } catch (error) {
    chipLog("error", "chip.disconnect.failed", chipName, {
      duration_ms: Date.now() - start,
      detail: String(error).slice(0, 300),
    });
    return NextResponse.json(
      { error: "Failed to disconnect chip", details: String(error) },
      { status: 500 }
    );
  }
}
