import { NextResponse } from "next/server";
import { fetchInstances } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const instances = await fetchInstances();
    const summary = {
      total: instances.length,
      online: instances.filter(
        (i: { connectionStatus: string }) => i.connectionStatus === "open"
      ).length,
      offline: instances.filter(
        (i: { connectionStatus: string }) => i.connectionStatus !== "open"
      ).length,
      chips: instances.map(
        (i: {
          name: string;
          connectionStatus: string;
          number: string;
          Proxy: { enabled: boolean } | null;
          Chatwoot: { enabled: boolean } | null;
        }) => ({
          name: i.name,
          status: i.connectionStatus,
          number: i.number,
          proxy: !!i.Proxy?.enabled,
          chatwoot: !!i.Chatwoot?.enabled,
        })
      ),
    };
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch status", details: String(error) },
      { status: 500 }
    );
  }
}
