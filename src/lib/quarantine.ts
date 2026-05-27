import { logoutInstance, setChatwoot } from "./evolution";
import { deleteInboxByName } from "./chatwoot";

// Quarentena de chip zombie. Chamado quando probe + restart falharam em recuperar
// a sessao Baileys. Forca a instance pra `close` (logout, nao delete — usuario
// pode reconectar via UI) e remove imediatamente do Chatwoot pra agentes nao
// tentarem mandar msg que vai falhar silenciosamente.
//
// Sequencia:
//   1) setChatwoot(name, false) — desabilita integration na Evolution
//   2) logoutInstance(name)     — fecha WebSocket, state vai pra `close`
//   3) deleteInboxByName(name)  — remove inbox do Chatwoot
//
// Cada step e isolado: falha em um nao impede os outros.
export interface QuarantineResult {
  name: string;
  steps: {
    disable_chatwoot: { ok: boolean; detail?: string };
    logout: { ok: boolean; detail?: string };
    delete_inbox: { ok: boolean; deleted?: number; detail?: string };
  };
}

export async function quarantineZombie(name: string): Promise<QuarantineResult> {
  const steps: QuarantineResult["steps"] = {
    disable_chatwoot: { ok: false },
    logout: { ok: false },
    delete_inbox: { ok: false },
  };

  try {
    await setChatwoot(name, false);
    steps.disable_chatwoot = { ok: true };
  } catch (e) {
    steps.disable_chatwoot = { ok: false, detail: String(e).slice(0, 150) };
  }

  try {
    await logoutInstance(name);
    steps.logout = { ok: true };
  } catch (e) {
    steps.logout = { ok: false, detail: String(e).slice(0, 150) };
  }

  try {
    const deleted = await deleteInboxByName(name);
    steps.delete_inbox = { ok: true, deleted };
  } catch (e) {
    steps.delete_inbox = { ok: false, detail: String(e).slice(0, 150) };
  }

  return { name, steps };
}
