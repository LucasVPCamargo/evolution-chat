import { NextResponse } from "next/server";
import { fetchInstances, probeChipSession } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";

// Probe leve da sessao Baileys de cada chip "open". Detecta zombie state
// (UI open, WS interno morto). Resultado eh usado pra mostrar badge vermelho
// no card pedindo Reset manual. NAO faz acao de recovery — auto-heal faz.

export const maxDuration = 30;

const PROBE_CONCURRENCY = 5;

async function mapBatched<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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
    if (!Array.isArray(instances)) {
      return NextResponse.json({ zombies: [], probed: 0 });
    }

    const open = (instances as Array<{ name: string; connectionStatus: string }>)
      .filter((i) => i.connectionStatus === "open")
      .map((i) => i.name);

    const zombies: Array<{ name: string; reason: string }> = [];
    await mapBatched(open, PROBE_CONCURRENCY, async (name) => {
      const probe = await probeChipSession(name);
      if (!probe.alive) {
        zombies.push({ name, reason: probe.reason });
      }
    });

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      probed: open.length,
      zombies,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Probe failed", details: String(error).slice(0, 200) },
      { status: 500 },
    );
  }
}
