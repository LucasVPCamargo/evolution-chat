const API_URL = process.env.EVOLUTION_API_URL!;
const API_KEY = process.env.EVOLUTION_API_KEY!;

const headers = {
  apikey: API_KEY,
  "Content-Type": "application/json",
};

const DEFAULT_TIMEOUT_MS = 8000;

function timedFetch(url: string, init: RequestInit = {}, ms: number = DEFAULT_TIMEOUT_MS) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

export async function createInstance(name: string, number: string) {
  const res = await timedFetch(`${API_URL}/instance/create`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      instanceName: name,
      integration: "WHATSAPP-BAILEYS",
      number,
      qrcode: true,
    }),
  }, 12000);
  return res.json();
}

export async function connectInstance(name: string) {
  const res = await timedFetch(`${API_URL}/instance/connect/${name}`, {
    method: "GET",
    headers,
  }, 10000);
  return res.json();
}

export async function getConnectionState(name: string) {
  const res = await timedFetch(`${API_URL}/instance/connectionState/${name}`, {
    headers,
  }, 5000);
  return res.json();
}

export async function fetchInstances() {
  const res = await timedFetch(`${API_URL}/instance/fetchInstances`, { headers }, 10000);
  return res.json();
}

export async function deleteInstance(name: string) {
  const res = await timedFetch(`${API_URL}/instance/delete/${name}`, {
    method: "DELETE",
    headers,
  });
  return res.json();
}

export async function logoutInstance(name: string) {
  const res = await timedFetch(`${API_URL}/instance/logout/${name}`, {
    method: "DELETE",
    headers,
  });
  return res.json();
}

export async function restartInstance(name: string) {
  const res = await timedFetch(`${API_URL}/instance/restart/${name}`, {
    method: "POST",
    headers,
  });
  return res.json();
}

export async function findProxy(name: string) {
  const res = await timedFetch(`${API_URL}/proxy/find/${name}`, { headers }, 5000);
  return res.json();
}

export interface ManualProxy {
  host: string;
  port: string;
  username: string;
  password: string;
  protocol?: string;
}

export async function setProxy(name: string, manual?: ManualProxy) {
  if (!manual) {
    // Fallback proxy compartilhado marketbet quando manual nao foi passado.
    // Usado raramente — auto-heal/connect normalmente passa proxy fresh via API
    // marketbet (lib/marketbet.ts). Sem manual e sem MARKETBET_PROXY_*, eh erro.
    const host = process.env.MARKETBET_PROXY_HOST;
    const port = process.env.MARKETBET_PROXY_PORT;
    const username = process.env.MARKETBET_PROXY_USERNAME;
    const password = process.env.MARKETBET_PROXY_PASSWORD;
    if (!host || !port || !username || !password) {
      throw new Error("setProxy: nem manual nem MARKETBET_PROXY_* configurado");
    }
    manual = { host, port, username, password, protocol: "http" };
  }

  const body = {
    enabled: true,
    host: manual.host,
    port: manual.port,
    protocol: manual.protocol || "http",
    username: manual.username,
    password: manual.password,
  };

  const res = await timedFetch(`${API_URL}/proxy/set/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function setSettings(name: string) {
  const res = await timedFetch(`${API_URL}/settings/set/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      rejectCall: false,
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
    }),
  });
  return res.json();
}

export async function setChatwoot(name: string, enabled = true) {
  // autoCreate: SEMPRE false. Quando Evolution cria inbox sozinho, usa URL interna
  // errada (http://evolution-api:8080) que chatwoot-rails NAO RESOLVE (containers
  // em network Docker separada). Nosso createInbox em chatwoot.ts cria com URL
  // correta (EVOLUTION_WEBHOOK_BASE = IP externo). setChatwoot so configura a
  // integration Evolution -> Chatwoot, nao precisa criar inbox.
  const res = await timedFetch(`${API_URL}/chatwoot/set/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      enabled,
      accountId: process.env.CHATWOOT_ACCOUNT_ID!,
      token: process.env.CHATWOOT_API_TOKEN!,
      url: process.env.CHATWOOT_INTERNAL_URL!,
      signMsg: false,
      reopenConversation: true,
      conversationPending: false,
      nameInbox: `WhatsApp - ${name}`,
      importContacts: false,
      importMessages: false,
      daysLimitImportMessages: 0,
      autoCreate: false,
      organization: "Atendimento",
      logo: "",
    }),
  });
  return res.json();
}
