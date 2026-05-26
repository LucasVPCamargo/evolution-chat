// Lista conversas abertas de um inbox e mostra estrutura pra desenhar pattern matching.
// Uso: node ... <inboxId>
const id = process.argv[2];
if (!id) { console.error("Uso: ... <inboxId>"); process.exit(1); }

const cwUrl = process.env.CHATWOOT_API_URL;
const t = process.env.CHATWOOT_API_TOKEN;
const a = process.env.CHATWOOT_ACCOUNT_ID;
const r = await fetch(`${cwUrl}/api/v1/accounts/${a}/conversations?inbox_id=${id}&status=open`, { headers: { api_access_token: t } });
const d = await r.json();
const list = d.data?.payload ?? d.data ?? d.payload ?? [];
console.log(`Conversas open: ${list.length}\n`);

// Amostra 3 conversas pra ver campos
for (const c of list.slice(0, 3)) {
  console.log("--- conv id:", c.id, "---");
  console.log("contact name:", c.meta?.sender?.name);
  console.log("contact phone:", c.meta?.sender?.phone_number);
  console.log("last msg:", JSON.stringify(c.last_non_activity_message?.content || c.messages?.[0]?.content || "(none)").slice(0, 200));
  console.log("last_activity_at:", new Date((c.last_activity_at || 0) * 1000).toISOString());
}
