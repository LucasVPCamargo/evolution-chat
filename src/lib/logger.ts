// Logger estruturado em JSON para Vercel Observability.
// Cada call vira UMA linha JSON com chaves padronizadas (level, event, chip, ts).
// O dashboard de Observability parseia esses campos automaticamente e permite
// filtros tipo `event:chip.connect.failed` ou `chip:SPAM-A02`.

type Level = "info" | "warn" | "error";

export interface ChipLogExtra {
  // Campos comuns que podem aparecer em qualquer evento.
  number?: string;
  proxy_mode?: "manual" | "auto";
  proxy_host?: string;
  proxy_port?: string;
  proxy_ip?: string;
  proxy_city?: string;
  proxy_country?: string;
  reason?: string;
  detail?: string;
  duration_ms?: number;
  status?: string;
  old_session?: string;
  new_session?: string;
  // Catch-all para campos especificos do evento.
  [key: string]: unknown;
}

// Loga um evento estruturado.
// - level: severidade
// - event: namespace pontuado (ex: chip.connect.started, proxy.heal.cycle.completed)
// - chip: nome do chip (ou null para eventos globais como proxy.heal.cycle.*)
// - extra: campos adicionais — nunca colocar senhas/tokens aqui.
export function chipLog(
  level: Level,
  event: string,
  chip: string | null,
  extra: ChipLogExtra = {},
): void {
  const entry = {
    level,
    event,
    chip,
    ts: new Date().toISOString(),
    ...extra,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

// Helper para extrair info nao-sensivel de um objeto de proxy (sem senha).
export function safeProxyMeta(proxy: { host?: string; port?: string; username?: string } | null | undefined) {
  if (!proxy) return null;
  return {
    proxy_host: proxy.host,
    proxy_port: proxy.port,
    // username pode conter info de session (IPRoyal) — incluir e util pra debug
    proxy_username: proxy.username,
  };
}
