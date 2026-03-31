import { NextRequest, NextResponse } from "next/server";
import { setProxy, setChatwoot, setSettings } from "@/lib/evolution";
import type { ManualProxy } from "@/lib/evolution";
import { createInbox, addAllAgentsToInbox } from "@/lib/chatwoot";
import { requireAuth } from "@/lib/auth";

export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { name, manualProxy } = await req.json() as {
      name?: string;
      manualProxy?: ManualProxy;
    };

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    // Configure proxy, inbox, settings, and chatwoot integration in parallel
    const [proxy, inbox] = await Promise.all([
      setProxy(name, manualProxy).catch(() => null),
      createInbox(name).catch(() => null),
      setSettings(name).catch(() => null),
    ]);

    // Add all agents to the new inbox
    if (inbox?.id) {
      await addAllAgentsToInbox(inbox.id).catch(() => null);
    }

    const chatwoot = await setChatwoot(name).catch(() => null);

    return NextResponse.json({ proxy, inbox, chatwoot });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to setup chip", details: String(error) },
      { status: 500 }
    );
  }
}
