import { NextRequest, NextResponse } from "next/server";
import { restartInstance } from "@/lib/evolution";
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

    chipLog("info", "chip.restart.requested", name, {});
    const result = await restartInstance(name);
    chipLog("info", "chip.restart.completed", name, { duration_ms: Date.now() - start });
    return NextResponse.json(result);
  } catch (error) {
    chipLog("error", "chip.restart.failed", chipName, {
      duration_ms: Date.now() - start,
      detail: String(error).slice(0, 300),
    });
    return NextResponse.json(
      { error: "Failed to restart chip", details: String(error) },
      { status: 500 }
    );
  }
}
