import { NextRequest, NextResponse } from "next/server";
import { connectInstance } from "@/lib/evolution";
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

    chipLog("info", "chip.reconnect.requested", name, {});
    const connection = await connectInstance(name);
    const pairingCode = connection?.pairingCode || null;

    chipLog("info", "chip.reconnect.completed", name, {
      duration_ms: Date.now() - start,
      status: pairingCode ? "pairing_code_issued" : "no_pairing_code",
    });

    return NextResponse.json({ pairingCode, connection });
  } catch (error) {
    chipLog("error", "chip.reconnect.failed", chipName, {
      duration_ms: Date.now() - start,
      detail: String(error).slice(0, 300),
    });
    return NextResponse.json(
      { error: "Failed to reconnect chip", details: String(error) },
      { status: 500 }
    );
  }
}
