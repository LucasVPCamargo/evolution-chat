// Recria inbox Chatwoot de 1 chip: delete + createInbox (com env nova) + addAllAgents + setChatwoot.
// Uso: node ... <chipName>
const name = process.argv[2];
if (!name) { console.error("Uso: ... <chipName>"); process.exit(1); }

const cwUrl = process.env.CHATWOOT_API_URL;
const cwToken = process.env.CHATWOOT_API_TOKEN;
const acc = process.env.CHATWOOT_ACCOUNT_ID;
const evoUrl = process.env.EVOLUTION_API_URL;
const evoKey = process.env.EVOLUTION_API_KEY;
const webhookBase = process.env.EVOLUTION_WEBHOOK_BASE;

const cwH = { api_access_token: cwToken, "Content-Type": "application/json" };
const evoH = { apikey: evoKey, "Content-Type": "application/json" };

console.log(`Webhook base configurado: ${webhookBase}\n`);

console.log("=== 1. Lista inboxes atuais com esse nome ===");
const list = ((await (await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes`, { headers: { api_access_token: cwToken } })).json()).payload ?? []).filter(i => i.name === `WhatsApp - ${name}`);
console.log(`Encontradas: ${list.length}`);
for (const i of list) console.log(`  id=${i.id} webhook=${i.webhook_url}`);

console.log("\n=== 2. Deleta inboxes existentes ===");
for (const i of list) {
  const r = await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes/${i.id}`, { method: "DELETE", headers: cwH });
  console.log(`  delete ${i.id}: ${r.status}`);
}

console.log("\n=== 3. Aguarda 3s pra cache ===");
await new Promise((r) => setTimeout(r, 3000));

console.log("\n=== 4. Cria inbox nova ===");
const createRes = await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes`, {
  method: "POST",
  headers: cwH,
  body: JSON.stringify({
    name: `WhatsApp - ${name}`,
    channel: {
      type: "api",
      webhook_url: `${webhookBase}/chatwoot/webhook/${encodeURIComponent(name)}`,
    },
  }),
});
const newInbox = await createRes.json();
console.log(`  status: ${createRes.status}`);
console.log(`  new inbox id: ${newInbox.id}  webhook: ${newInbox.webhook_url}`);

console.log("\n=== 5. Adiciona todos agentes ===");
const agents = await (await fetch(`${cwUrl}/api/v1/accounts/${acc}/agents`, { headers: { api_access_token: cwToken } })).json();
const agentIds = agents.map((a) => a.id);
console.log(`  agentes: ${agentIds.length}`);
if (agentIds.length > 0 && newInbox.id) {
  const r = await fetch(`${cwUrl}/api/v1/accounts/${acc}/inbox_members`, {
    method: "POST",
    headers: cwH,
    body: JSON.stringify({ inbox_id: newInbox.id, user_ids: agentIds }),
  });
  console.log(`  status: ${r.status}`);
}

console.log("\n=== 6. setChatwoot na Evolution (autoCreate=FALSE pra nao duplicar) ===");
const setRes = await fetch(`${evoUrl}/chatwoot/set/${name}`, {
  method: "POST",
  headers: evoH,
  body: JSON.stringify({
    enabled: true,
    accountId: acc,
    token: cwToken,
    url: process.env.CHATWOOT_INTERNAL_URL,
    signMsg: false,
    reopenConversation: true,
    conversationPending: false,
    nameInbox: `WhatsApp - ${name}`,
    importContacts: false,
    importMessages: false,
    daysLimitImportMessages: 0,
    autoCreate: false,
    organization: "Atendimento",
    logo: "",
  }),
});
console.log(`  status: ${setRes.status}`);

console.log("\n=== 7. Confirma webhook final ===");
const final = ((await (await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes`, { headers: { api_access_token: cwToken } })).json()).payload ?? []).find(i => i.name === `WhatsApp - ${name}`);
if (final) console.log(`  inbox id=${final.id}  webhook=${final.webhook_url}`);
