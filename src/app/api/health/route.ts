import { NextResponse } from "next/server";
import { runHealthChecks } from "@/lib/health";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const health = await runHealthChecks();

  return NextResponse.json(health, {
    headers: { "Cache-Control": "no-store" },
  });
}
