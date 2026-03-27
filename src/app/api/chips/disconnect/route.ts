import { NextRequest, NextResponse } from "next/server";
import { deleteInstance } from "@/lib/evolution";
import { deleteInboxByName } from "@/lib/chatwoot";
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

    const [result, inboxesDeleted] = await Promise.all([
      deleteInstance(name),
      deleteInboxByName(name).catch(() => 0),
    ]);

    return NextResponse.json({ ...result, inboxesDeleted });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to disconnect chip", details: String(error) },
      { status: 500 }
    );
  }
}
