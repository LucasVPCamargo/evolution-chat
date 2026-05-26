// Cliente da API da marketbet pra gerar proxies brasileiros residenciais dedicados.
// Cada chamada retorna 1 proxy "fixo" novo, na porta unica (11000+), com IP residencial
// estavel naquela porta. Cada chip pode ter sua propria identidade IP, em vez de todos
// compartilharem 74.81.81.81:823.
//
// Doc API: POST https://checker.marketbet.com.br/api/v1/proxy/gerar.php
// Body: { quantidade, tipo (fixo|rotativo), country, state?, city? }
// Response.data.proxies = ["host:port:username:password", ...]

const API_URL = "https://checker.marketbet.com.br/api/v1/proxy/gerar.php";

export interface MarketbetProxy {
  host: string;
  port: string;
  username: string;
  password: string;
  protocol: "http";
}

export interface GenerateOptions {
  tipo?: "fixo" | "rotativo";
  country?: string;
  state?: string;
  city?: string;
}

export async function generateProxy(opts?: GenerateOptions): Promise<MarketbetProxy> {
  const apiKey = process.env.MARKETBET_API_KEY;
  if (!apiKey) {
    throw new Error("MARKETBET_API_KEY not configured");
  }

  const body = {
    quantidade: 1,
    tipo: opts?.tipo ?? "fixo",
    country: opts?.country ?? "br",
    ...(opts?.state ? { state: opts.state } : {}),
    ...(opts?.city ? { city: opts.city } : {}),
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Marketbet HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data?.success) {
    throw new Error(`Marketbet error: ${data?.message ?? JSON.stringify(data).slice(0, 200)}`);
  }
  const proxies = data?.data?.proxies as string[] | undefined;
  if (!proxies || proxies.length === 0) {
    throw new Error("Marketbet returned no proxies");
  }

  return parseProxyString(proxies[0]);
}

// Parse "host:port:username:password" onde username pode conter ; (ex: state.X;city.Y)
// mas nunca contem :. So split em ate 4 partes.
function parseProxyString(raw: string): MarketbetProxy {
  const parts = raw.split(":");
  if (parts.length !== 4) {
    throw new Error(`Invalid proxy format: ${raw.slice(0, 80)}`);
  }
  return {
    host: parts[0],
    port: parts[1],
    username: parts[2],
    password: parts[3],
    protocol: "http",
  };
}

// Formata pro padrao usado no UI/painel: "host:port:username:password"
export function formatProxyString(p: MarketbetProxy): string {
  return `${p.host}:${p.port}:${p.username}:${p.password}`;
}
