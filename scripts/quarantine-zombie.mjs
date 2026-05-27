// Quarentena one-shot de um chip zombie. Mesmo fluxo do helper quarantineZombie
// em src/lib/quarantine.ts: desabilita Chatwoot integration, logout (chip vai
// pra "close"), deleta inbox no Chatwoot. NAO deleta a instance — chip pode
// ser reconectado pelo painel.
//
// Uso: node --env-file=.env.local scripts/quarantine-zombie.mjs <chipName>

const name = process.argv[2];
if (!name) {
  console.error("Uso: node --env-file=.env.local scripts/quarantine-zombie.mjs <chipName>");
  process.exit(1);
}

const EVO = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const CW = process.env.CHATWOOT_API_URL;
const CW_TOKEN = process.env.CHATWOOT_API_TOKEN;
const CW_ACC = process.env.CHATWOOT_ACCOUNT_ID;

if (!EVO || !EVO_KEY || !CW || !CW_TOKEN || !CW_ACC) {
  console.error("Faltando env vars (EVOLUTION_API_URL/KEY, CHATWOOT_API_URL/TOKEN/ACCOUNT_ID)");
  process.exit(1);
}

const evoHeaders = { apikey: EVO_KEY, "Content-Type": "application/json" };
const cwHeaders = { api_access_token: CW_TOKEN, "Content-Type": "application/json" };

async function step(label, fn) {
  try {
    const result = await fn();
    console.log(`[ok ] ${label}`, result ?? "");
    return { ok: true, result };
  } catch (e) {
    console.log(`[err] ${label}: ${String(e).slice(0, 200)}`);
    return { ok: false, error: String(e) };
  }
}

// 1) Desabilita Chatwoot integration
await step("disable_chatwoot", async () => {
  const res = await fetch(`${EVO}/chatwoot/set/${name}`, {
    method: "POST",
    headers: evoHeaders,
    body: JSON.stringify({
      enabled: false,
      accountId: CW_ACC,
      token: CW_TOKEN,
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
  const body = await res.text();
  return `${res.status} ${body.slice(0, 100)}`;
});

// 2a) Restart primeiro pra desfreezar Baileys (zombie nao responde logout direto)
await step("restart", async () => {
  const res = await fetch(`${EVO}/instance/restart/${name}`, {
    method: "POST",
    headers: evoHeaders,
  });
  const body = await res.text();
  return `${res.status} ${body.slice(0, 100)}`;
});

// 2b) Aguarda Baileys reiniciar
console.log("[wait] 8s pra Baileys reiniciar...");
await new Promise((r) => setTimeout(r, 8000));

// 2c) Confere connection state pos-restart
await step("connection_state_post_restart", async () => {
  const res = await fetch(`${EVO}/instance/connectionState/${name}`, { headers: evoHeaders });
  const body = await res.text();
  return `${res.status} ${body.slice(0, 150)}`;
});

// 2d) Logout — agora deve funcionar (chip vai pra "close" no Evolution)
await step("logout", async () => {
  const res = await fetch(`${EVO}/instance/logout/${name}`, {
    method: "DELETE",
    headers: evoHeaders,
  });
  const body = await res.text();
  return `${res.status} ${body.slice(0, 100)}`;
});

// 3) Deleta inbox no Chatwoot
const inboxResult = await step("find_and_delete_inbox", async () => {
  const list = await fetch(`${CW}/api/v1/accounts/${CW_ACC}/inboxes`, { headers: cwHeaders }).then(r => r.json());
  const inboxes = list.payload ?? list ?? [];
  const targets = inboxes.filter((i) => i.name === `WhatsApp - ${name}`);
  if (targets.length === 0) return "no inbox found";
  const deleted = [];
  for (const inb of targets) {
    const r = await fetch(`${CW}/api/v1/accounts/${CW_ACC}/inboxes/${inb.id}`, {
      method: "DELETE",
      headers: cwHeaders,
    });
    deleted.push(`id=${inb.id} status=${r.status}`);
  }
  return deleted.join(", ");
});

console.log("\nfeito. abra o painel e veja se o chip está em close e sumiu do Chatwoot.");
console.log("se ainda aparece como zombie no painel, dá um Atualizar (o probe local pode ter cache de até 3min).");
