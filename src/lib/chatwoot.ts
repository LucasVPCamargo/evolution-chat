const CHATWOOT_URL = process.env.CHATWOOT_API_URL!;
const CHATWOOT_TOKEN = process.env.CHATWOOT_API_TOKEN!;
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID!;
const EVOLUTION_WEBHOOK_BASE = process.env.EVOLUTION_WEBHOOK_BASE!;

const headers = {
  api_access_token: CHATWOOT_TOKEN,
  "Content-Type": "application/json",
};

const DEFAULT_TIMEOUT_MS = 8000;

function timedFetch(url: string, init: RequestInit = {}, ms: number = DEFAULT_TIMEOUT_MS) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

export async function createInbox(chipName: string) {
  const res = await timedFetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/inboxes`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: `WhatsApp - ${chipName}`,
        channel: {
          type: "api",
          webhook_url: `${EVOLUTION_WEBHOOK_BASE}/chatwoot/webhook/${encodeURIComponent(chipName)}`,
        },
      }),
    }
  );
  return res.json();
}

export async function listInboxes() {
  const res = await timedFetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/inboxes`,
    { headers }
  );
  return res.json();
}

export async function deleteInbox(inboxId: number) {
  const res = await timedFetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/inboxes/${inboxId}`,
    { method: "DELETE", headers }
  );
  if (res.status === 200 || res.status === 204) return { success: true };
  return res.json();
}

export async function addAllAgentsToInbox(inboxId: number) {
  const agentsRes = await timedFetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/agents`,
    { headers }
  );
  const agents = await agentsRes.json();
  const agentIds = (agents as { id: number }[]).map((a) => a.id);

  if (agentIds.length === 0) return null;

  const res = await timedFetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/inbox_members`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ inbox_id: inboxId, user_ids: agentIds }),
    }
  );
  return res.json();
}

export async function deleteInboxByName(chipName: string): Promise<number> {
  const data = await listInboxes();
  const inboxes = data.payload ?? data ?? [];
  const matches = inboxes.filter(
    (i: { name: string }) => i.name === `WhatsApp - ${chipName}`
  );
  let deleted = 0;
  for (const inbox of matches) {
    const result = await deleteInbox(inbox.id);
    if ("success" in result) deleted++;
  }
  return deleted;
}

export async function findInboxByName(chipName: string): Promise<{ id: number; name: string } | null> {
  const data = await listInboxes();
  const inboxes = data.payload ?? data ?? [];
  return inboxes.find((i: { name: string }) => i.name === `WhatsApp - ${chipName}`) ?? null;
}

interface ChatwootConversation {
  id: number;
  meta?: {
    sender?: { phone_number?: string; identifier?: string };
  };
  contact?: { phone_number?: string };
}

export async function listConversationsForInbox(inboxId: number, status: "open" | "all" = "open") {
  const res = await timedFetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations?inbox_id=${inboxId}&status=${status}`,
    { headers }
  );
  const data = await res.json();
  const list: ChatwootConversation[] = data.data?.payload ?? data.data ?? data.payload ?? data ?? [];
  return list;
}

export async function resolveConversation(conversationId: number) {
  const res = await timedFetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/toggle_status`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ status: "resolved" }),
    }
  );
  if (res.status === 200 || res.status === 204) return { success: true };
  return res.json();
}

// Normaliza numero pra comparacao (so digitos, ultimos 11). Aceita "+5511...", "5511..."
// e formas com espacos.
function normalizeNumber(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.replace(/\D/g, "").slice(-11);
}

// Remove caracteres invisiveis (zero-width spaces/joiners/marks) que o maturador
// injeta entre letras pra evitar deteccao por regex simples (ex: "C​o‌dWMI").
const INVISIBLE_RE = /[​-‏⁠-⁯﻿­]/g;
function stripInvisible(s: string): string {
  return s.replace(INVISIBLE_RE, "");
}

// Resolve conversas que sao do maturador de chips. Detecta por DOIS sinais:
//   1) Nome do contato contem "WMI" (ex: "Contato WMI 28779", "WMI-260513-1187")
//   2) Conteudo da ultima mensagem contem "CodWMI" (ex: "CodWMI0029s ...")
// Em ambos os casos, strip de caracteres invisiveis antes de bater regex,
// porque o maturador injeta zero-width chars entre letras pra evitar match.
export async function resolveWmiConversations(inboxId: number): Promise<{ resolved: number; checked: number }> {
  const convs = await listConversationsForInbox(inboxId, "open");
  let resolved = 0;
  for (const c of convs as Array<{
    id: number;
    meta?: { sender?: { name?: string } };
    last_non_activity_message?: { content?: string };
    messages?: Array<{ content?: string }>;
  }>) {
    const name = stripInvisible(c.meta?.sender?.name || "");
    const lastMsgContent = stripInvisible(
      c.last_non_activity_message?.content || c.messages?.[0]?.content || ""
    );
    const isWmi = /\bWMI\b/i.test(name) || /CodWMI/i.test(lastMsgContent);
    if (isWmi) {
      const r = await resolveConversation(c.id);
      if ("success" in r) resolved++;
    }
  }
  return { resolved, checked: convs.length };
}

// Resolve conversas no inbox que pertencem ao proprio numero do chip (notificacao
// "device linked" que aparece no Chatwoot logo apos pareamento). Faz ate `attempts`
// tentativas espacadas, ja que a msg pode demorar alguns segundos pra chegar.
export async function resolveSelfConversations(
  inboxId: number,
  chipNumber: string,
  attempts = 3,
  delayMs = 5000,
): Promise<{ resolved: number; checked: number }> {
  const targetNorm = normalizeNumber(chipNumber);
  let resolved = 0;
  let checked = 0;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delayMs));
    const convs = await listConversationsForInbox(inboxId, "open");
    checked += convs.length;
    const targets = convs.filter((c) => {
      const phone = c.meta?.sender?.phone_number ?? c.contact?.phone_number;
      const norm = normalizeNumber(phone);
      return norm.length > 0 && norm === targetNorm;
    });
    for (const t of targets) {
      const r = await resolveConversation(t.id);
      if ("success" in r) resolved++;
    }
    if (resolved > 0) break;
  }

  return { resolved, checked };
}
