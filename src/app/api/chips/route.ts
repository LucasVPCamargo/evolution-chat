import { NextResponse } from "next/server";
import { fetchInstances } from "@/lib/evolution";
import { requireAuth } from "@/lib/auth";

// Campos que retornamos do Proxy pro frontend. NAO expomos `password` (credencial
// real do proxy) nem `username` (parte da credencial). Sessao sticky e parseada
// separadamente do password pra mostrar no card.
interface SafeProxyDetails {
  enabled: boolean;
  host?: string;
  port?: string;
  protocol?: string;
  session?: string | null;
}

interface RawProxy {
  enabled?: boolean;
  host?: string;
  port?: string;
  protocol?: string;
  password?: string;
}

function sanitizeProxy(raw: RawProxy | null | undefined): SafeProxyDetails | null {
  if (!raw) return null;
  const sessionMatch = raw.password?.match(/session-(.+)$/);
  return {
    enabled: !!raw.enabled,
    host: raw.host,
    port: raw.port,
    protocol: raw.protocol,
    session: sessionMatch ? sessionMatch[1] : null,
  };
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const instances = await fetchInstances();
    if (!Array.isArray(instances)) return NextResponse.json(instances);

    // fetchInstances ja retorna Proxy embedded com todos os campos — eliminado
    // o N+1 antigo (era 1 fetchInstances + 45x findProxy). Agora 1 round-trip
    // serve pra montar a lista inteira.
    const enriched = (instances as Record<string, unknown>[]).map((inst) => ({
      ...inst,
      Proxy: inst.Proxy ? { enabled: (inst.Proxy as { enabled?: boolean }).enabled ?? false } : null,
      proxyDetails: sanitizeProxy(inst.Proxy as RawProxy | null),
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch instances", details: String(error) },
      { status: 500 }
    );
  }
}
