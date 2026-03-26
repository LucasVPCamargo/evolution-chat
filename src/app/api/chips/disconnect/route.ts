import { NextRequest, NextResponse } from "next/server";
import { deleteInstance } from "@/lib/evolution";
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

    const result = await deleteInstance(name);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to disconnect chip", details: String(error) },
      { status: 500 }
    );
  }
}
