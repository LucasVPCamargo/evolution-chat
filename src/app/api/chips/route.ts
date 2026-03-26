import { NextResponse } from "next/server";
import { fetchInstances } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const instances = await fetchInstances();
    return NextResponse.json(instances);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch instances", details: String(error) },
      { status: 500 }
    );
  }
}
