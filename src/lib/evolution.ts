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
//
// Pipeline:
//   1. POST /instance/create — Evolution as vezes devolve 200 com qrcode.count:0 antes do
//      Baileys terminar o handshake via proxy. Nao falhamos imediatamente nesse caso.
//   2. Poll GET /instance/connect/{name} a cada 2s por ate 8s para recuperar o pairing code
//      que apareceu apos o create retornar.
//   3. Se ainda nada: deleta a instância, espera 1s, tenta tudo de novo (1 retry).
//   4. Apos a 2a tentativa: retorna a resposta com flags _firstError/_secondError para o log.
//
// Total worst-case: ~50s. /api/chips/connect tem maxDuration 60.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createInstance(name: string, number: string, manualProxy?: ManualProxy): Promise<any> {
  const body = JSON.stringify({
    instanceName: name,
    integration: "WHATSAPP-BAILEYS",
    number,
    qrcode: true,
    proxy: buildProxyConfig(name, manualProxy),
  });

  const createOnce = async () => {
    const res = await timedFetch(`${API_URL}/instance/create`, { method: "POST", headers, body }, 15000);
    return res.json();
  };

  // Poll /instance/connect/{name} para recuperar pairing code emitido tardiamente.
  // Devolve { pairingCode, code, base64 } ou null se nao apareceu no janela.
  const pollPairingCode = async (windowMs: number): Promise<{ pairingCode: string; code?: string; base64?: string } | null> => {
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await timedFetch(`${API_URL}/instance/connect/${name}`, { method: "GET", headers }, 5000);
        const data = (await res.json()) as { pairingCode?: string; code?: string; base64?: string };
        if (data?.pairingCode) {
          return { pairingCode: data.pairingCode, code: data.code, base64: data.base64 };
        }
      } catch {
        // ignore — proximo poll tenta de novo
      }
    }
    return null;
  };

  // Best-effort delete antes do retry para evitar conflitos.
  const tryDelete = async () => {
    try {
      await timedFetch(`${API_URL}/instance/delete/${name}`, { method: "DELETE", headers }, 4000);
    } catch { /* silencioso */ }
  };

  const attachPolled = (
    response: Record<string, unknown>,
    polled: { pairingCode: string; code?: string; base64?: string },
  ) => ({
    ...response,
    qrcode: {
      ...((response.qrcode as Record<string, unknown>) || {}),
      pairingCode: polled.pairingCode,
      code: polled.code,
      base64: polled.base64,
      count: 1,
    },
    _recovered_via_poll: true,
  });

  // Tentativa 1
  let first: Record<string, unknown> | null = null;
  let firstError: unknown = null;
  try {
    first = await createOnce();
  } catch (err) {
    firstError = err;
  }

  if ((first as { qrcode?: { pairingCode?: string } })?.qrcode?.pairingCode) {
    return first;
  }

  if (first && (first as { instance?: { instanceName?: string } }).instance?.instanceName === name) {
    const polled = await pollPairingCode(8000);
    if (polled) return attachPolled(first, polled);
  }

  // Tentativa 2 (apos limpar e backoff de 1s)
  await tryDelete();
  await new Promise((r) => setTimeout(r, 1000));

  let second: Record<string, unknown> | null = null;
  let secondError: unknown = null;
  try {
    second = await createOnce();
  } catch (err) {
    secondError = err;
  }

  if ((second as { qrcode?: { pairingCode?: string } })?.qrcode?.pairingCode) {
    return { ...second, _retried: true };
  }

  if (second && (second as { instance?: { instanceName?: string } }).instance?.instanceName === name) {
    const polled = await pollPairingCode(8000);
    if (polled) return { ...attachPolled(second, polled), _retried: true };
  }

  // Tudo falhou — limpa a instância residual e devolve a melhor resposta com diagnostico.
  await tryDelete();
  return {
    ...(second || first || {}),
    _firstError: firstError ? String(firstError).slice(0, 200) : "no_pairing_code_first_attempt",
    _secondError: secondError ? String(secondError).slice(0, 200) : "no_pairing_code_second_attempt",
    _retried: true,
  };
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
