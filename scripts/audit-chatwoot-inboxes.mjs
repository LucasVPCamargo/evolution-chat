// Auditoria de Chatwoot inboxes vs estado dos chips na Evolution.
// Identifica:
//   - Inboxes "WhatsApp - X" cujo chip X esta close/offline (deve ser tratado)
//   - Inboxes "WhatsApp - X" cujo chip X nao existe mais na Evolution (orfas - delete)
//   - Inboxes que nao tem prefixo "WhatsApp -" (outras, ignora)

const evoUrl = process.env.EVOLUTION_API_URL;
const evoKey = process.env.EVOLUTION_API_KEY;
const cwUrl = process.env.CHATWOOT_API_URL;
const cwToken = process.env.CHATWOOT_API_TOKEN;
const acc = process.env.CHATWOOT_ACCOUNT_ID;

console.log("=== Estado dos chips na Evolution ===");
const chips = await (await fetch(`${evoUrl}/instance/fetchInstances`, { headers: { apikey: evoKey } })).json();
const chipMap = new Map(); // name -> connectionStatus
for (const c of chips) chipMap.set(c.name, c.connectionStatus);
console.log(`Total chips: ${chips.length}`);
const byStatus = { open: 0, connecting: 0, close: 0 };
for (const [, status] of chipMap) {
  if (status in byStatus) byStatus[status]++;
}
console.log(`  open: ${byStatus.open}  connecting: ${byStatus.connecting}  close: ${byStatus.close}`);

console.log("\n=== Inboxes no Chatwoot ===");
const inboxData = await (await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes`, { headers: { api_access_token: cwToken } })).json();
const inboxes = inboxData.payload ?? inboxData ?? [];
const waInboxes = inboxes.filter(i => /^WhatsApp\s*-\s*/.test(i.name || ""));
console.log(`Total inboxes: ${inboxes.length}`);
console.log(`Inboxes "WhatsApp - X": ${waInboxes.length}`);

console.log("\n=== Analise por inbox WhatsApp ===");
const categories = { match_open: [], match_connecting: [], match_close: [], orphan_no_chip: [] };
for (const inb of waInboxes) {
  const chipName = inb.name.replace(/^WhatsApp\s*-\s*/, "").trim();
  const chipStatus = chipMap.get(chipName);
  const entry = { inboxId: inb.id, name: inb.name, chipName, chipStatus };
  if (!chipStatus) categories.orphan_no_chip.push(entry);
  else if (chipStatus === "open") categories.match_open.push(entry);
  else if (chipStatus === "connecting") categories.match_connecting.push(entry);
  else categories.match_close.push(entry);
}

const printList = (label, items) => {
  console.log(`\n${label} (${items.length}):`);
  for (const i of items) console.log(`  [${i.inboxId}] ${i.name}${i.chipStatus ? ` -> chip status: ${i.chipStatus}` : ` -> CHIP NAO EXISTE`}`);
};

printList("✅ Inbox + chip ONLINE", categories.match_open);
printList("⚠️  Inbox + chip CONNECTING", categories.match_connecting);
printList("❌ Inbox + chip CLOSE (problema)", categories.match_close);
printList("👻 Inbox sem chip correspondente (orfa)", categories.orphan_no_chip);

console.log("\n=== Resumo ===");
console.log(`Total a tratar: ${categories.match_close.length + categories.orphan_no_chip.length}`);
console.log(`  - chips em close ainda com inbox ativa: ${categories.match_close.length}`);
console.log(`  - inboxes orfas (chip nao existe): ${categories.orphan_no_chip.length}`);
