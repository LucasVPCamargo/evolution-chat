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

export interface ManualProxy {
  host: string;
  port: string;
  username: string;
  password: string;
  protocol?: string;
}

// Monta o objeto de proxy para enviar a Evolution. Aceita proxy manual ou cai no
// default IPRoyal com sticky-session unica por chip (country=br, session=name).
export function buildProxyConfig(name: string, manual?: ManualProxy) {
  if (manual) {
    return {
      enabled: true,
      host: manual.host,
      port: manual.port,
      protocol: manual.protocol || "http",
      username: manual.username,
      password: manual.password,
    };
  }
  return {
    enabled: true,
    host: process.env.PROXY_HOST!,
    port: process.env.PROXY_PORT!,
    protocol: process.env.PROXY_PROTOCOL || "http",
    username: process.env.PROXY_USERNAME!,
    password: `${process.env.PROXY_PASSWORD!}_country-br_session-${name}-${Date.now()}`,
  };
}

// Cria a instancia ja com proxy inline para que o Baileys nunca abra WS pelo IP do servidor.
// Tenta uma vez; se a Evolution responder erro transiente (timeout/5xx), refaz uma vez.
export async function createInstance(name: string, number: string, manualProxy?: ManualProxy) {
  const body = JSON.stringify({
    instanceName: name,
    integration: "WHATSAPP-BAILEYS",
    number,
    qrcode: true,
    proxy: buildProxyConfig(name, manualProxy),
  });

  const attempt = () =>
    timedFetch(`${API_URL}/instance/create`, { method: "POST", headers, body }, 12000)
      .then((r) => r.json());

  try {
    return await attempt();
  } catch (err) {
    // Backoff curto antes do retry: 1500ms.
    await new Promise((r) => setTimeout(r, 1500));
    const second = await attempt();
    if (second?.qrcode?.pairingCode) return second;
    // Se o retry tambem nao deu pairingCode, devolve o ultimo response com o erro original anexado.
    return { ...second, _firstError: String(err).slice(0, 200) };
  }
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

export async function setProxy(name: string, manual?: ManualProxy) {
  const res = await timedFetch(`${API_URL}/proxy/set/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(buildProxyConfig(name, manual)),
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
