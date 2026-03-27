import { NextRequest, NextResponse } from "next/server";
import {
  createInstance,
  setProxy,
  setChatwoot,
} from "@/lib/evolution";
import { createInbox } from "@/lib/chatwoot";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { name, number } = await req.json();

    if (!name || !number) {
      return NextResponse.json(
        { error: "name and number are required" },
        { status: 400 }
      );
    }

    // Step 1: Create instance (qrcode:true already generates pairing code)
    const instance = await createInstance(name, number);
    const pairingCode = instance?.qrcode?.pairingCode || null;

    // Step 2: Configure proxy + Chatwoot in parallel (non-blocking)
    const [proxy, inbox] = await Promise.all([
      setProxy(name).catch(() => null),
      createInbox(name).catch(() => null),
    ]);

    // Step 3: Configure Chatwoot integration in Evolution
    const chatwoot = await setChatwoot(name).catch(() => null);

    return NextResponse.json({
      instance,
      proxy,
      inbox,
      chatwoot,
      pairingCode,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to connect chip", details: String(error) },
      { status: 500 }
    );
  }
}
