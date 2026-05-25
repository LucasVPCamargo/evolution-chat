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

// Deadline absoluto pra criacao + retry caber em maxDuration. /api/chips/connect tem 90s;
// reservamos 85s pra deixar 5s pro response/refresh final.
const TOTAL_BUDGET_MS = 85_000;

// Cria a instancia garantindo que Baileys NUNCA abra WS pro WhatsApp pelo IP do servidor.
//
// Evolution 2.3.7 ignora o campo `proxy` em /instance/create (testado: chips criados com
// inline proxy ficam com proxy=null no banco). Por isso o fluxo correto e:
//
//   1. POST /instance/create { qrcode: false } — cria a instancia em estado "close" (Baileys
//      NAO inicia ainda)
//   2. POST /proxy/set/{name} — persiste o proxy no banco. Evolution valida o proxy ANTES
//      de salvar (faz uma request via proxy), entao precisa de timeout generoso: 25s.
//   3. GET /proxy/find/{name} — verifica que o proxy ficou salvo. Se nao ficou, aborta.
//   4. GET /instance/connect/{name} — Baileys inicia AGORA, ja com proxy ativo, e retorna
//      o pairing code
//   5. Se nao veio code: poll a cada 1s por ate 10s
//   6. Refresh final via novo GET /instance/connect — maximiza validade WhatsApp (~40s),
//      so executa se houver budget restante.
//
// Erros sao trackados em _firstError, _secondError; existe 1 retry (delete + recreate)
// somente se houver budget restante. Cada step loga sua propria duracao em _step_durations.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createInstance(name: string, number: string, manualProxy?: ManualProxy): Promise<any> {
  const proxyConfig = buildProxyConfig(name, manualProxy);
  const startedAt = Date.now();
  const stepDurations: Record<string, number> = {};
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  const createOnce = async () => {
    const t0 = Date.now();
    const body = JSON.stringify({
      instanceName: name,
      integration: "WHATSAPP-BAILEYS",
      number,
      qrcode: false,
    });
    const res = await timedFetch(`${API_URL}/instance/create`, { method: "POST", headers, body }, 12000);
    const data = await res.json();
    stepDurations.create = Date.now() - t0;
    return data;
  };

  // 25s: Evolution valida o proxy (faz request HTTP via proxy) antes de salvar. Proxies BR
  // residenciais com sticky-session as vezes chegam a >15s. Era 15s e batia TimeoutError em
  // producao (vide STATUS-2026-05-22). Se a primeira falhar com erro, retentamos 1x com 15s
  // — Evolution as vezes valida mais rapido na segunda chamada (cache de DNS/sessao).
  const setProxyOnce = async () => {
    const t0 = Date.now();
    const doCall = async (timeoutMs: number) => {
      const res = await timedFetch(`${API_URL}/proxy/set/${name}`, {
        method: "POST",
        headers,
        body: JSON.stringify(proxyConfig),
      }, timeoutMs);
      return res.json();
    };
    try {
      const data = await doCall(25000);
      stepDurations.set_proxy = Date.now() - t0;
      return data;
    } catch (e) {
      stepDurations.set_proxy_first_attempt_failed = Date.now() - t0;
      // Retry imediato se houver budget. 15s eh suficiente; se primeira passou validacao,
      // segunda costuma fechar em 2-5s.
      if (remaining() >= 18000) {
        const t1 = Date.now();
        try {
          const data = await doCall(15000);
          stepDurations.set_proxy = (Date.now() - t0);
          stepDurations.set_proxy_retry = Date.now() - t1;
          return data;
        } catch (e2) {
          stepDurations.set_proxy = Date.now() - t0;
          throw e2;
        }
      }
      throw e;
    }
  };

  // Verifica se o proxy foi persistido. Retorna true se sim.
  const verifyProxy = async (): Promise<boolean> => {
    const t0 = Date.now();
    try {
      const res = await timedFetch(`${API_URL}/proxy/find/${name}`, { method: "GET", headers }, 5000);
      const data = await res.json();
      stepDurations.verify_proxy = Date.now() - t0;
      return Boolean(data && typeof data === "object" && (data as { host?: string }).host);
    } catch {
      stepDurations.verify_proxy = Date.now() - t0;
      return false;
    }
  };

  // Captura o raw response da ultima chamada /instance/connect quando nao vier
  // pairing code, pra diagnosticar (vem base64 puro? vem vazio? veio erro?).
  let lastConnectRaw: string | null = null;

  // GET /instance/connect?number={number} — dispara Baileys (na primeira chamada) e/ou
  // refaz o pairing code. O ?number= forca a Evolution a gerar pairing code mesmo quando
  // estaria caindo no fallback de QR; sem ele, observamos Evolution devolvendo so base64.
  // Aceitamos `pairingCode` (preferido) OU `base64` (QR como fallback usavel).
  const fetchPairingCode = async (timeoutMs = 12000): Promise<{ pairingCode?: string; code?: string; base64?: string } | null> => {
    try {
      const url = `${API_URL}/instance/connect/${name}?number=${encodeURIComponent(number)}`;
      const res = await timedFetch(url, { method: "GET", headers }, timeoutMs);
      const raw = await res.text();
      lastConnectRaw = raw.slice(0, 800);
      let data: { pairingCode?: string; code?: string; base64?: string } = {};
      try { data = JSON.parse(raw); } catch { /* nao-json */ }
      if (data?.pairingCode) return { pairingCode: data.pairingCode, code: data.code, base64: data.base64 };
      if (data?.base64) return { base64: data.base64, code: data.code };
    } catch { /* ignore */ }
    return null;
  };

  // Poll a cada 1s por ate windowMs, respeitando o budget total.
  const pollPairingCode = async (windowMs: number) => {
    const deadline = Math.min(Date.now() + windowMs, startedAt + TOTAL_BUDGET_MS - 2000);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const got = await fetchPairingCode(5000);
      if (got) return got;
    }
    return null;
  };

  const tryDelete = async () => {
    try {
      await timedFetch(`${API_URL}/instance/delete/${name}`, { method: "DELETE", headers }, 4000);
    } catch { /* silencioso */ }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildSuccess = (pairing: { pairingCode?: string; code?: string; base64?: string }, extras: Record<string, unknown> = {}): any => ({
    instance: { instanceName: name, status: "connecting" },
    qrcode: {
      pairingCode: pairing.pairingCode,
      code: pairing.code,
      base64: pairing.base64,
      count: 1,
    },
    _proxy_set: true,
    _step_durations: { ...stepDurations },
    _via_qr_fallback: !pairing.pairingCode && Boolean(pairing.base64),
    ...extras,
  });

  // Tenta o fluxo completo. Retorna sucesso ou null para tentar de novo.
  // Tambem retorna o motivo do erro se falhou.
  const runAttempt = async (): Promise<{ success?: Record<string, unknown>; error?: string }> => {
    let createResp: Record<string, unknown>;
    try {
      createResp = await createOnce();
    } catch (e) {
      return { error: `create_failed: ${String(e).slice(0, 150)}` };
    }

    const instanceName = (createResp as { instance?: { instanceName?: string } }).instance?.instanceName;
    if (instanceName !== name) {
      return { error: `create_unexpected_response: ${JSON.stringify(createResp).slice(0, 200)}` };
    }

    try {
      await setProxyOnce();
    } catch (e) {
      return { error: `set_proxy_failed: ${String(e).slice(0, 150)}` };
    }

    const proxyOk = await verifyProxy();
    if (!proxyOk) {
      return { error: "proxy_not_persisted_after_set" };
    }

    // Baileys vai iniciar AGORA, ja com o proxy ativo. Primeira tentativa de pairing code.
    const first = await fetchPairingCode(12000);
    if (first) return { success: buildSuccess(first) };

    // Se nao veio na primeira, pola por ate 10s (limitado pelo budget restante).
    const polled = await pollPairingCode(10000);
    if (polled) return { success: buildSuccess(polled, { _recovered_via_poll: true }) };

    return { error: "no_pairing_code_after_poll" };
  };

  // Faz refresh final do code para garantir validade maxima WhatsApp (~40s a partir de agora).
  // So executa se houver budget; refresh e nice-to-have, nao critico.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refreshFinal = async (success: Record<string, unknown>): Promise<any> => {
    if (remaining() < 5000) return success;
    const fresh = await fetchPairingCode(5000);
    if (fresh) {
      return {
        ...success,
        qrcode: { pairingCode: fresh.pairingCode, code: fresh.code, base64: fresh.base64, count: 1 },
        _refreshed: true,
      };
    }
    return success;
  };

  // Tentativa 1
  const first = await runAttempt();
  if (first.success) return refreshFinal(first.success);

  // Tentativa 2 so se houver budget suficiente (delete + backoff + outro flow completo).
  // Pior caso de runAttempt: ~52s. So vale a pena retentar se sobrar pelo menos 30s.
  if (remaining() >= 30000) {
    await tryDelete();
    await new Promise((r) => setTimeout(r, 1500));

    const second = await runAttempt();
    if (second.success) return refreshFinal({ ...second.success, _retried: true });

    await tryDelete();
    return {
      instance: { instanceName: name, status: "failed" },
      qrcode: { count: 0 },
      _firstError: first.error || "unknown",
      _secondError: second.error || "unknown",
      _retried: true,
      _step_durations: stepDurations,
      _total_duration_ms: Date.now() - startedAt,
      _last_connect_raw: lastConnectRaw,
    };
  }

  // Sem budget pra retry — devolve so o erro da primeira tentativa.
  await tryDelete();
  return {
    instance: { instanceName: name, status: "failed" },
    qrcode: { count: 0 },
    _firstError: first.error || "unknown",
    _secondError: "skipped_no_budget",
    _retried: false,
    _step_durations: stepDurations,
    _total_duration_ms: Date.now() - startedAt,
    _last_connect_raw: lastConnectRaw,
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
