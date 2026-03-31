export interface ServiceHealth {
  service: "evolution" | "chatwoot" | "proxy";
  ok: boolean;
  latencyMs: number;
  detail?: string;
  ip?: string;
  country?: string;
  city?: string;
}

export interface HealthResponse {
  healthy: boolean;
  timestamp: string;
  services: ServiceHealth[];
}

export async function checkEvolution(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const res = await fetch(
      `${process.env.EVOLUTION_API_URL}/instance/fetchInstances`,
      {
        headers: { apikey: process.env.EVOLUTION_API_KEY! },
        signal: AbortSignal.timeout(8000),
      }
    );
    const ok = res.status === 200;
    return {
      service: "evolution",
      ok,
      latencyMs: Date.now() - start,
      detail: ok ? `v2 respondendo (${res.status})` : `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      service: "evolution",
      ok: false,
      latencyMs: Date.now() - start,
      detail: String(e).slice(0, 100),
    };
  }
}

export async function checkChatwoot(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const res = await fetch(
      `${process.env.CHATWOOT_API_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/inboxes`,
      {
        headers: { api_access_token: process.env.CHATWOOT_API_TOKEN! },
        signal: AbortSignal.timeout(8000),
      }
    );
    const ok = res.status === 200;
    return {
      service: "chatwoot",
      ok,
      latencyMs: Date.now() - start,
      detail: ok ? `API respondendo (${res.status})` : `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      service: "chatwoot",
      ok: false,
      latencyMs: Date.now() - start,
      detail: String(e).slice(0, 100),
    };
  }
}

export async function checkProxy(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const { ProxyAgent } = await import("undici");
    const proxyUrl = `http://${process.env.PROXY_USERNAME}:${process.env.PROXY_PASSWORD}_country-br_session-healthcheck@${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`;
    const agent = new ProxyAgent(proxyUrl);

    const res = await fetch("http://ip-api.com/json/?fields=status,country,countryCode,city,query", {
      // @ts-expect-error dispatcher is valid in Node.js with undici
      dispatcher: agent,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();

    const isBR = data.countryCode === "BR";
    return {
      service: "proxy",
      ok: isBR,
      latencyMs: Date.now() - start,
      ip: data.query,
      country: data.countryCode,
      city: data.city,
      detail: isBR
        ? `IP ${data.query} - ${data.city}, BR`
        : `IP ${data.query} - ${data.countryCode} (esperado BR)`,
    };
  } catch (e) {
    return {
      service: "proxy",
      ok: false,
      latencyMs: Date.now() - start,
      detail: String(e).slice(0, 100),
    };
  }
}

export async function checkProxyForInstance(
  instanceName: string,
  proxyPassword?: string
): Promise<{ ip: string; country: string; city: string; latencyMs: number } | null> {
  try {
    const { ProxyAgent } = await import("undici");
    const password = proxyPassword || `${process.env.PROXY_PASSWORD!}_country-br_session-${instanceName}`;
    const proxyUrl = `http://${process.env.PROXY_USERNAME}:${password}@${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`;
    const agent = new ProxyAgent(proxyUrl);
    const start = Date.now();
    const res = await fetch("http://ip-api.com/json/?fields=status,country,countryCode,city,query", {
      // @ts-expect-error dispatcher is valid in Node.js with undici
      dispatcher: agent,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return {
      ip: data.query,
      country: data.countryCode,
      city: data.city,
      latencyMs: Date.now() - start,
    };
  } catch {
    return null;
  }
}

export async function runHealthChecks(): Promise<HealthResponse> {
  const results = await Promise.allSettled([
    checkEvolution(),
    checkChatwoot(),
    checkProxy(),
  ]);

  const services = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const names: Array<"evolution" | "chatwoot" | "proxy"> = ["evolution", "chatwoot", "proxy"];
    return {
      service: names[i],
      ok: false,
      latencyMs: 0,
      detail: String(r.reason).slice(0, 100),
    };
  });

  return {
    healthy: services.every((s) => s.ok),
    timestamp: new Date().toISOString(),
    services,
  };
}
