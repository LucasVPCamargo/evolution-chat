import { NextResponse } from "next/server";
import { fetchInstances, findProxy, getConnectionState } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";
import { deleteInboxByName } from "@/lib/chatwoot";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const instances = await fetchInstances();
    if (!Array.isArray(instances)) return NextResponse.json(instances);

    const enriched = await Promise.all(
      instances.map(async (inst: Record<string, unknown>) => {
        const name = inst.name as string;
        let realStatus = inst.connectionStatus as string;

        // Para chips que o Evolution reporta como "open", verificar estado real
        if (realStatus === "open") {
          try {
            const state = await getConnectionState(name);
            const actualState = state?.instance?.state || state?.state;
            if (actualState && actualState !== "open") {
              realStatus = actualState;
              // Chip caiu mas Evolution ainda reportava "open" — limpar inbox
              if (actualState === "close") {
                deleteInboxByName(name).catch(() => {});
              }
            }
          } catch {
            // Se falhar a checagem, manter o status original
          }
        }

        try {
          const proxyData = await findProxy(name);
          return { ...inst, connectionStatus: realStatus, proxyDetails: proxyData };
        } catch {
          return { ...inst, connectionStatus: realStatus, proxyDetails: null };
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
