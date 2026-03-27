import { NextRequest, NextResponse } from "next/server";
import { connectInstance } from "@/lib/evolution";
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

    const connection = await connectInstance(name);
    const pairingCode = connection?.pairingCode || null;

    return NextResponse.json({ pairingCode, connection });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to reconnect chip", details: String(error) },
      { status: 500 }
    );
  }
}
