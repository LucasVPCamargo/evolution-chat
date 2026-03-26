const API_URL = process.env.EVOLUTION_API_URL!;
const API_KEY = process.env.EVOLUTION_API_KEY!;

const headers = {
  apikey: API_KEY,
  "Content-Type": "application/json",
};

export async function createInstance(name: string, number: string) {
  const res = await fetch(`${API_URL}/instance/create`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      instanceName: name,
      integration: "WHATSAPP-BAILEYS",
      number,
      qrcode: false,
    }),
  });
  return res.json();
}

export async function connectInstance(name: string, number: string) {
  const res = await fetch(`${API_URL}/instance/connect/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ number }),
  });
  return res.json();
}

export async function getConnectionState(name: string) {
  const res = await fetch(`${API_URL}/instance/connectionState/${name}`, {
    headers,
  });
  return res.json();
}

export async function fetchInstances() {
  const res = await fetch(`${API_URL}/instance/fetchInstances`, { headers });
  return res.json();
}

export async function deleteInstance(name: string) {
  const res = await fetch(`${API_URL}/instance/delete/${name}`, {
    method: "DELETE",
    headers,
  });
  return res.json();
}

export async function logoutInstance(name: string) {
  const res = await fetch(`${API_URL}/instance/logout/${name}`, {
    method: "DELETE",
    headers,
  });
  return res.json();
}

export async function restartInstance(name: string) {
  const res = await fetch(`${API_URL}/instance/restart/${name}`, {
    method: "POST",
    headers,
  });
  return res.json();
}

export async function setProxy(name: string) {
  const basePassword = process.env.PROXY_PASSWORD!;
  const res = await fetch(`${API_URL}/proxy/set/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      enabled: true,
      host: process.env.PROXY_HOST!,
      port: process.env.PROXY_PORT!,
      protocol: process.env.PROXY_PROTOCOL || "http",
      username: process.env.PROXY_USERNAME!,
      password: `${basePassword}_country-br_session-${name}_lifetime-24h`,
    }),
  });
  return res.json();
}

export async function setChatwoot(name: string) {
  const res = await fetch(`${API_URL}/chatwoot/set/${name}`, {
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
      importContacts: true,
      importMessages: true,
      daysLimitImportMessages: 3,
      autoCreate: true,
      organization: "Atendimento",
      logo: "",
    }),
  });
  return res.json();
}
