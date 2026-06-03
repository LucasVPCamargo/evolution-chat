// Recupera a integracao Chatwoot dos chips apos o teardown de 03/06/2026.
// Para cada chip ALIVE (probe ok): recria a inbox "WhatsApp - <name>" se faltar,
// adiciona todos os agentes e reativa a integracao Evolution->Chatwoot.
// Idempotente: se a inbox ja existe, so reativa o chatwoot. Pula chips nao-alive.
//
// Uso: node --env-file=.env.local scripts/recover-inboxes.mjs

const EVO = process.env.EVOLUTION_API_URL;
const EVOKEY = process.env.EVOLUTION_API_KEY;
const CW = process.env.CHATWOOT_API_URL;                 // externo, p/ criar inbox via API
const CWTOKEN = process.env.CHATWOOT_API_TOKEN;
const ACC = process.env.CHATWOOT_ACCOUNT_ID;
const CWINTERNAL = process.env.CHATWOOT_INTERNAL_URL;    // Evolution -> Chatwoot
const WEBHOOK_BASE = process.env.EVOLUTION_WEBHOOK_BASE || "http://204.168.142.226:8080";

const evoH = { apikey: EVOKEY, "Content-Type": "application/json" };
const cwH = { api_access_token: CWTOKEN, "Content-Type": "application/json" };

async function probe(name) {
  try {
    const r = await fetch(`${EVO}/chat/whatsappNumbers/${name}`, {
      method: "POST", headers: evoH,
      body: JSON.stringify({ numbers: ["5511999999999"] }),
      signal: AbortSignal.timeout(12000),
    });
    return r.ok;
  } catch { return false; }
}

async function listInboxes() {
  const r = await fetch(`${CW}/api/v1/accounts/${ACC}/inboxes`, { headers: cwH });
  const d = await r.json();
  return d.payload ?? d ?? [];
}

async function createInbox(name) {
  const r = await fetch(`${CW}/api/v1/accounts/${ACC}/inboxes`, {
    method: "POST", headers: cwH,
    body: JSON.stringify({
      name: `WhatsApp - ${name}`,
      channel: { type: "api", webhook_url: `${WEBHOOK_BASE}/chatwoot/webhook/${encodeURIComponent(name)}` },
    }),
  });
  return r.json();
}

async function addAgents(inboxId) {
  const ar = await fetch(`${CW}/api/v1/accounts/${ACC}/agents`, { headers: cwH });
  const agents = await ar.json();
  const ids = (Array.isArray(agents) ? agents : []).map((a) => a.id);
  if (!ids.length) return 0;
  await fetch(`${CW}/api/v1/accounts/${ACC}/inbox_members`, {
    method: "POST", headers: cwH,
    body: JSON.stringify({ inbox_id: inboxId, user_ids: ids }),
  });
  return ids.length;
}

async function setChatwoot(name) {
  const r = await fetch(`${EVO}/chatwoot/set/${name}`, {
    method: "POST", headers: evoH,
    body: JSON.stringify({
      enabled: true, accountId: ACC, token: CWTOKEN, url: CWINTERNAL,
      signMsg: false, reopenConversation: true, conversationPending: false,
      nameInbox: `WhatsApp - ${name}`, importContacts: false, importMessages: false,
      daysLimitImportMessages: 0, autoCreate: false, organization: "Atendimento", logo: "",
    }),
  });
  return r.json();
}

const ir = await fetch(`${EVO}/instance/fetchInstances`, { headers: { apikey: EVOKEY } });
const list = await ir.json();
list.sort((a, b) => a.name.localeCompare(b.name));

const inboxes = await listInboxes();
const byName = new Map(
  inboxes.filter((i) => /^WhatsApp - /.test(i.name || "")).map((i) => [i.name, i])
);

console.log(`webhook_base=${WEBHOOK_BASE} | inboxes WhatsApp existentes: ${byName.size}\n`);

let recovered = 0, skipped = 0;
for (const i of list) {
  const name = i.name;
  const alive = i.connectionStatus === "open" ? await probe(name) : false;
  if (!alive) {
    console.log(`${name.padEnd(9)} SKIP (status=${i.connectionStatus})`);
    skipped++;
    continue;
  }
  const inboxName = `WhatsApp - ${name}`;
  const actions = [];
  let inbox = byName.get(inboxName);
  if (!inbox) {
    const created = await createInbox(name);
    if (created?.id) {
      inbox = created;
      const n = await addAgents(created.id);
      actions.push(`inbox#${created.id}+${n}agents`);
    } else {
      actions.push(`INBOX_FAIL:${JSON.stringify(created).slice(0, 80)}`);
    }
  } else {
    actions.push(`inbox#${inbox.id}(ja existia)`);
  }
  const cw = await setChatwoot(name);
  actions.push(cw?.chatwoot?.enabled || cw?.enabled ? "chatwoot=ON" : `chatwoot?=${JSON.stringify(cw).slice(0, 70)}`);
  console.log(`${name.padEnd(9)} ${actions.join(" ")}`);
  recovered++;
}
console.log(`\nRecuperados: ${recovered} | Pulados (nao-alive): ${skipped}`);
