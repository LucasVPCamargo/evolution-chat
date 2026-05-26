// Deleta inboxes Chatwoot cujo chip esta em close OU nao existe na Evolution.
// Antes de deletar, desabilita Chatwoot integration na Evolution pro chip (se ainda existir)
// pra Evolution parar de tentar postar nessa inbox.

const evoUrl = process.env.EVOLUTION_API_URL;
const evoKey = process.env.EVOLUTION_API_KEY;
const cwUrl = process.env.CHATWOOT_API_URL;
const cwToken = process.env.CHATWOOT_API_TOKEN;
const acc = process.env.CHATWOOT_ACCOUNT_ID;
const evoH = { apikey: evoKey, "Content-Type": "application/json" };
const cwH = { api_access_token: cwToken };

const chips = await (await fetch(`${evoUrl}/instance/fetchInstances`, { headers: evoH })).json();
const chipMap = new Map();
for (const c of chips) chipMap.set(c.name, c);

const inboxData = await (await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes`, { headers: cwH })).json();
const inboxes = inboxData.payload ?? inboxData ?? [];

const toDelete = [];
for (const inb of inboxes) {
  const m = (inb.name || "").match(/^WhatsApp\s*-\s*(.+)$/);
  if (!m) continue;
  const chipName = m[1].trim();
  const chip = chipMap.get(chipName);
  if (!chip) {
    toDelete.push({ inboxId: inb.id, name: inb.name, chipName, reason: "chip nao existe" });
  } else if (chip.connectionStatus === "close") {
    toDelete.push({ inboxId: inb.id, name: inb.name, chipName, reason: "chip em close", chipExists: true });
  }
}

console.log(`Inboxes a deletar: ${toDelete.length}\n`);

for (const item of toDelete) {
  console.log(`--- ${item.name} (chip: ${item.chipName}, ${item.reason}) ---`);

  // Se chip existe e esta close, desabilita Chatwoot integration antes
  if (item.chipExists) {
    try {
      const r = await fetch(`${evoUrl}/chatwoot/set/${item.chipName}`, {
        method: "POST",
        headers: evoH,
        body: JSON.stringify({
          enabled: false,
          accountId: process.env.CHATWOOT_ACCOUNT_ID,
          token: cwToken,
          url: process.env.CHATWOOT_INTERNAL_URL,
          signMsg: false,
          reopenConversation: true,
          conversationPending: false,
          nameInbox: item.name,
          importContacts: false,
          importMessages: false,
          daysLimitImportMessages: 0,
          autoCreate: false,
          organization: "Atendimento",
          logo: "",
        }),
      });
      console.log(`  disable chatwoot integration: ${r.status}`);
    } catch (e) {
      console.log(`  disable chatwoot failed: ${String(e).slice(0, 100)}`);
    }
  }

  // Deleta inbox no Chatwoot
  try {
    const r = await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes/${item.inboxId}`, {
      method: "DELETE",
      headers: cwH,
    });
    console.log(`  delete inbox ${item.inboxId}: ${r.status}`);
  } catch (e) {
    console.log(`  delete inbox failed: ${String(e).slice(0, 100)}`);
  }
}

console.log(`\n--- Concluido ---`);
