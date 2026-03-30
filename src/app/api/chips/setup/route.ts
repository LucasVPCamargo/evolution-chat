import { NextRequest, NextResponse } from "next/server";
import { setProxy, setChatwoot } from "@/lib/evolution";
import { createInbox } from "@/lib/chatwoot";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { name } = await req.json();

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    // Configure proxy, inbox, and chatwoot integration in parallel
    const [proxy, inbox] = await Promise.all([
      setProxy(name).catch(() => null),
      createInbox(name).catch(() => null),
    ]);

    const chatwoot = await setChatwoot(name).catch(() => null);

    return NextResponse.json({ proxy, inbox, chatwoot });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to setup chip", details: String(error) },
      { status: 500 }
    );
  }
}
