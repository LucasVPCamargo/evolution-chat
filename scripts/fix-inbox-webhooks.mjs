// Atualiza webhook_url de TODOS os inboxes "WhatsApp - X" pra usar IP externo.
// Necessario porque chatwoot-rails (em outra docker network) nao resolve hostname
// "evolution-api". Usando IP externo da VPS, qualquer container alcanca.

const cwUrl = process.env.CHATWOOT_API_URL;
const cwToken = process.env.CHATWOOT_API_TOKEN;
const acc = process.env.CHATWOOT_ACCOUNT_ID;
const NEW_BASE = "http://204.168.142.226:8080";
const cwH = { api_access_token: cwToken, "Content-Type": "application/json" };

const r = await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes`, { headers: { api_access_token: cwToken } });
const inboxes = (await r.json()).payload ?? [];
const waInboxes = inboxes.filter((i) => /^WhatsApp\s*-\s*/.test(i.name || ""));

console.log(`Inboxes WhatsApp a atualizar: ${waInboxes.length}\n`);

for (const inb of waInboxes) {
  const chipName = inb.name.replace(/^WhatsApp\s*-\s*/, "").trim();
  const desiredUrl = `${NEW_BASE}/chatwoot/webhook/${encodeURIComponent(chipName)}`;
  if (inb.webhook_url === desiredUrl) {
    console.log(`[skip] ${inb.name} (id ${inb.id}) ja esta correto`);
    continue;
  }
  console.log(`[patch] ${inb.name} (id ${inb.id})`);
  console.log(`  antes: ${inb.webhook_url || "(none)"}`);
  console.log(`  depois: ${desiredUrl}`);
  // Update via channel webhook URL endpoint. Chatwoot API supports patch inbox
  const patchRes = await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes/${inb.id}`, {
    method: "PATCH",
    headers: cwH,
    body: JSON.stringify({
      channel: {
        type: "api",
        webhook_url: desiredUrl,
      },
    }),
  });
  console.log(`  status: ${patchRes.status} body: ${(await patchRes.text()).slice(0, 200)}`);
}

console.log("\n--- Confirmacao apos patch ---");
const r2 = await fetch(`${cwUrl}/api/v1/accounts/${acc}/inboxes`, { headers: { api_access_token: cwToken } });
const fresh = ((await r2.json()).payload ?? []).filter((i) => /^WhatsApp\s*-\s*/.test(i.name || ""));
for (const inb of fresh) {
  const ok = inb.webhook_url && inb.webhook_url.startsWith(NEW_BASE);
  console.log(`${ok ? "✓" : "✗"} ${inb.name}: ${inb.webhook_url || "(none)"}`);
}
