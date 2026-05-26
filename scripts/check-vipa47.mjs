const cwUrl = process.env.CHATWOOT_API_URL;
const t = process.env.CHATWOOT_API_TOKEN;
const a = process.env.CHATWOOT_ACCOUNT_ID;
const r = await fetch(`${cwUrl}/api/v1/accounts/${a}/inboxes`, { headers: { api_access_token: t } });
const d = await r.json();
const list = d.payload || d || [];
const vipa47 = list.filter((i) => i.name === "WhatsApp - VIPA47");
console.log(`Inboxes "WhatsApp - VIPA47": ${vipa47.length}`);
for (const i of vipa47) {
  console.log(`  id=${i.id} webhook=${i.webhook_url || "(none)"}  identifier=${i.inbox_identifier || "(none)"}`);
}
