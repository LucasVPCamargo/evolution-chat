import { NextResponse } from "next/server";
import { fetchInstances, findProxy } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const instances = await fetchInstances();
    if (!Array.isArray(instances)) return NextResponse.json(instances);

    const enriched = await Promise.all(
      instances.map(async (inst: Record<string, unknown>) => {
        try {
          const proxyData = await findProxy(inst.name as string);
          return { ...inst, proxyDetails: proxyData };
        } catch {
          return { ...inst, proxyDetails: null };
        }
      })
    );

    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch instances", details: String(error) },
      { status: 500 }
    );
  }
}
