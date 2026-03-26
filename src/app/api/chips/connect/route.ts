import { NextRequest, NextResponse } from "next/server";
import {
  createInstance,
  connectInstance,
  setProxy,
  setChatwoot,
} from "@/lib/evolution";
import { createInbox } from "@/lib/chatwoot";

export async function POST(req: NextRequest) {
  try {
    const { name, number } = await req.json();

    if (!name || !number) {
      return NextResponse.json(
        { error: "name and number are required" },
        { status: 400 }
      );
    }

    // Step 1: Create instance
    const instance = await createInstance(name, number);

    // Step 2: Generate pairing code
    const connection = await connectInstance(name, number);

    // Step 3: Configure proxy with unique sticky session
    const proxy = await setProxy(name);

    // Step 4: Create Chatwoot inbox
    const inbox = await createInbox(name);

    // Step 5: Configure Chatwoot integration in Evolution
    const chatwoot = await setChatwoot(name);

    return NextResponse.json({
      instance,
      connection,
      proxy,
      inbox,
      chatwoot,
      pairingCode: connection?.pairingCode || connection?.code,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to connect chip", details: String(error) },
      { status: 500 }
    );
  }
}
