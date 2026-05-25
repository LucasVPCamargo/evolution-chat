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
  const body = manual
    ? {
        enabled: true,
        host: manual.host,
        port: manual.port,
        protocol: manual.protocol || "http",
        username: manual.username,
        password: manual.password,
      }
    : {
        enabled: true,
        host: process.env.PROXY_HOST!,
        port: process.env.PROXY_PORT!,
        protocol: process.env.PROXY_PROTOCOL || "http",
        username: process.env.PROXY_USERNAME!,
        password: `${process.env.PROXY_PASSWORD!}_country-br_session-${name}-${Date.now()}`,
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

export async function setChatwoot(name: string) {
  const res = await timedFetch(`${API_URL}/chatwoot/set/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      enabled: true,
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
      autoCreate: true,
      organization: "Atendimento",
      logo: "",
    }),
  });
  return res.json();
}
