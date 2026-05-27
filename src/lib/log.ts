// JSON-line logger pra correlacionar via Vercel logs grep.
// Uso: log("heal.phase3.zombie_detected", { chip: "VIPA39", reason: "connection_closed" })
// Output: {"event":"heal.phase3.zombie_detected","ts":"2026-05-27T...","chip":"VIPA39","reason":"connection_closed"}
export function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }));
}
