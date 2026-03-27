const CHATWOOT_URL = process.env.CHATWOOT_API_URL!;
const CHATWOOT_TOKEN = process.env.CHATWOOT_API_TOKEN!;
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID!;
const EVOLUTION_WEBHOOK_BASE = process.env.EVOLUTION_WEBHOOK_BASE!;

const headers = {
  api_access_token: CHATWOOT_TOKEN,
  "Content-Type": "application/json",
};

export async function createInbox(chipName: string) {
  const res = await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/inboxes`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: `WhatsApp - ${chipName}`,
        channel: {
          type: "api",
          webhook_url: `${EVOLUTION_WEBHOOK_BASE}/chatwoot/webhook/${chipName}`,
        },
      }),
    }
  );
  return res.json();
}

export async function listInboxes() {
  const res = await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/inboxes`,
    { headers }
  );
  return res.json();
}

export async function deleteInbox(inboxId: number) {
  const res = await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/inboxes/${inboxId}`,
    { method: "DELETE", headers }
  );
  if (res.status === 200 || res.status === 204) return { success: true };
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
