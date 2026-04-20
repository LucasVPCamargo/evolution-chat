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
