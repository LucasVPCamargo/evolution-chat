// Sweep imediato: resolve TODAS conversas open em TODAS inboxes WhatsApp
// cujo nome OU conteudo da ultima msg case com pattern WMI (com strip de
// zero-width chars).

const cwUrl = process.env.CHATWOOT_API_URL;
const t = process.env.CHATWOOT_API_TOKEN;
const a = process.env.CHATWOOT_ACCOUNT_ID;
const h = { api_access_token: t };

const INVISIBLE = /[​-‏⁠-⁯﻿­]/g;
const stripInv = (s) => (s || "").replace(INVISIBLE, "");

const inboxes = ((await (await fetch(`${cwUrl}/api/v1/accounts/${a}/inboxes`, { headers: h })).json()).payload ?? [])
  .filter((i) => /^WhatsApp\s*-\s*/.test(i.name || ""));

let totalResolved = 0;
let totalChecked = 0;

for (const inb of inboxes) {
  const r = await fetch(`${cwUrl}/api/v1/accounts/${a}/conversations?inbox_id=${inb.id}&status=open`, { headers: h });
  const d = await r.json();
  const convs = d.data?.payload ?? d.data ?? d.payload ?? [];
  totalChecked += convs.length;
  let inboxResolved = 0;
  for (const c of convs) {
    const name = stripInv(c.meta?.sender?.name);
    const lastMsg = stripInv(c.last_non_activity_message?.content || c.messages?.[0]?.content);
    const isWmi = /\bWMI\b/i.test(name) || /CodWMI/i.test(lastMsg);
    if (isWmi) {
      const res = await fetch(`${cwUrl}/api/v1/accounts/${a}/conversations/${c.id}/toggle_status`, {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      });
      if (res.status === 200) {
        inboxResolved++;
        console.log(`  resolved conv ${c.id}: name="${name}" msg="${lastMsg.slice(0, 50)}..."`);
      }
    }
  }
  totalResolved += inboxResolved;
  console.log(`${inb.name}: ${inboxResolved}/${convs.length} resolved`);
}

console.log(`\nTotal: ${totalResolved}/${totalChecked} resolved`);
