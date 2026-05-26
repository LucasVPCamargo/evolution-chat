// Forca delete de uma inbox Chatwoot com diagnostico verboso.
// Uso: node ... <inboxId>
const id = process.argv[2];
if (!id) { console.error("Uso: ... <inboxId>"); process.exit(1); }

const cwUrl = process.env.CHATWOOT_API_URL;
const cwToken = process.env.CHATWOOT_API_TOKEN;
const acc = process.env.CHATWOOT_ACCOUNT_ID;
const cwH = { api_access_token: cwToken };

console.log(`\n--- Inbox ${id}: estado antes ---`);
const before = await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes/${id}`, { headers: cwH });
console.log(`GET status: ${before.status}`);
if (before.status === 200) {
  const d = await before.json();
  console.log(`name: ${d.name || d.payload?.name}, id: ${d.id || d.payload?.id}`);
}

console.log(`\n--- DELETE attempt ---`);
const r = await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes/${id}`, {
  method: "DELETE",
  headers: cwH,
});
console.log(`DELETE status: ${r.status}`);
console.log(`DELETE body: ${(await r.text()).slice(0, 300)}`);

console.log(`\n--- Estado depois ---`);
await new Promise(r => setTimeout(r, 2000));
const after = await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes/${id}`, { headers: cwH });
console.log(`GET status: ${after.status}`);
if (after.status === 200) {
  console.log(`AINDA EXISTE`);
  const d = await after.json();
  // Tenta investigar — talvez tem conversas pendentes
  const convsRes = await fetch(`${cwUrl}/api/v1/accounts/${acc}/conversations?inbox_id=${id}&status=open`, { headers: cwH });
  const convs = await convsRes.json();
  const list = convs.data?.payload || convs.data || convs.payload || convs || [];
  console.log(`Conversas open neste inbox: ${list.length}`);
  if (list.length) console.log(`  IDs: ${list.slice(0, 5).map(c => c.id).join(", ")}`);
} else {
  console.log(`DELETADA ✓`);
}
