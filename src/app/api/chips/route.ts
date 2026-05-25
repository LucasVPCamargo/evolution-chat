import { NextResponse } from "next/server";
import { fetchInstances, findProxy } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";

const PROXY_LOOKUP_CONCURRENCY = 5;

async function mapBatched<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const instances = await fetchInstances();
    if (!Array.isArray(instances)) return NextResponse.json(instances);

    const enriched = await mapBatched(
      instances as Record<string, unknown>[],
      PROXY_LOOKUP_CONCURRENCY,
      async (inst) => {
        const proxyEnabled = (inst.Proxy as { enabled?: boolean } | null)?.enabled;
        if (!proxyEnabled) return { ...inst, proxyDetails: null };
        try {
          const proxyData = await findProxy(inst.name as string);
          return { ...inst, proxyDetails: proxyData };
        } catch {
          return { ...inst, proxyDetails: null };
        }
      },
    );

    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch instances", details: String(error) },
      { status: 500 }
    );
  }
}
