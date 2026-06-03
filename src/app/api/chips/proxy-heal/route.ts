import { NextResponse, type NextRequest } from "next/server";
import { requireAuthOrCron } from "@/lib/auth";
import {
  fetchInstances,
  findProxy,
  setProxy,
  getConnectionState,
  restartInstance,
  setChatwoot,
  probeChipSession,
  type ManualProxy,
} from "@/lib/evolution";
import { checkProxyForInstance } from "@/lib/health";
import { generateProxy } from "@/lib/marketbet";
import { deleteInbox, listInboxes } from "@/lib/chatwoot";
import { quarantineZombie, type QuarantineResult } from "@/lib/quarantine";
import { log } from "@/lib/log";

// Proxy-heal: triggado da UI a cada 15min ou via Vercel Cron.
//
// Diferenca pro ciclo antigo (5min, agressivo): adicionamos histerese — toda
// acao mutativa (restart, heal, quarentena) exige 2 ciclos consecutivos de
// falha antes de disparar. Reduz falso-positivos de lag transitorio de
// marketbet/ip-api.com.
//
// Fases:
//  1) Stale check (getConnectionState)        → restart apos 2x stale
//  2) Proxy health (checkProxyForInstance)    → reheal apos 2x failed (orfao = imediato)
//  3) Zombie probe (probeChipSession)         → quarentena apos 2x zombie nao-recuperado
//  4) Inbox cleanup (orphans + close)         → idempotente, sem mutacao no chip
//
// REMOVIDO desta cycle vs anterior:
//  - Phase 4.3 recreate inbox: dead code (so disparava em zombies, agora skipados)
//  - Phase 4.4 resolveWmiConversations: movido pra /api/chips/wmi-resolve (30min)

export const maxDuration = 60;

interface HealResult {
  name: string;
  status: "healthy" | "healed" | "orphan_healed" | "restarted" | "unreachable" | "skipped" | "pending_hysteresis";
  ip?: string;
  city?: string;
  oldSession?: string;
  newSession?: string;
  detail?: string;
}

const STATE_CHECK_CONCURRENCY = 5;
const HEAL_CONCURRENCY = 3;
const HYSTERESIS_THRESHOLD = 2; // requires N consecutive cycles of same failure to act

// Estado de histerese: persiste durante a vida da funcao Vercel "warm".
// Cold start zera tudo, o que e ok — significa que precisamos de 2 ciclos
// completos pra agir. Conservador propositalmente.
//
// Cada chip pode acumular contadores independentes pra cada tipo de falha.
// Sucesso (chip saudavel) zera o contador correspondente.
interface ChipHysteresis {
  stale: number;        // Phase 1
  proxy_failed: number; // Phase 2
  zombie: number;       // Phase 3
}
const hysteresis = new Map<string, ChipHysteresis>();

function getHyst(name: string): ChipHysteresis {
  let h = hysteresis.get(name);
  if (!h) {
    h = { stale: 0, proxy_failed: 0, zombie: 0 };
    hysteresis.set(name, h);
  }
  return h;
}

function getMarketbetProxy(): ManualProxy | null {
  const host = process.env.MARKETBET_PROXY_HOST;
  const port = process.env.MARKETBET_PROXY_PORT;
  const username = process.env.MARKETBET_PROXY_USERNAME;
  const password = process.env.MARKETBET_PROXY_PASSWORD;
  if (!host || !port || !username || !password) return null;
  return { host, port, username, password, protocol: "http" };
}

async function mapBatched<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function healOrphan(name: string, marketbetEnv: ManualProxy | null): Promise<HealResult> {
  try {
    let proxy: ManualProxy;
    try {
      const fresh = await generateProxy({ tipo: "fixo", country: "br" });
      proxy = {
        host: fresh.host,
        port: fresh.port,
        username: fresh.username,
        password: fresh.password,
        protocol: fresh.protocol,
      };
    } catch {
      if (!marketbetEnv) {
        return { name, status: "unreachable", detail: "marketbet API failed e nao tem env fallback" };
      }
      proxy = marketbetEnv;
    }

    await setProxy(name, proxy);
    await new Promise((r) => setTimeout(r, 400));
    const conf = await findProxy(name);
    if (!conf?.enabled) {
      return { name, status: "unreachable", detail: "proxy not persisted" };
    }
    await restartInstance(name);
    await new Promise((r) => setTimeout(r, 6000));
    const check = await checkProxyForInstance(name, conf);
    if (check && check.country === "BR") {
      log("heal.phase2.orphan_healed", { chip: name, ip: check.ip, city: check.city });
      return { name, status: "orphan_healed", ip: check.ip, city: check.city };
    }
    return { name, status: "unreachable", detail: "proxy test failed after heal" };
  } catch (e) {
    return { name, status: "unreachable", detail: String(e).slice(0, 100) };
  }
}

async function handle(req: NextRequest) {
  const denied = await requireAuthOrCron(req);
  if (denied) return denied;

  const cycleStart = Date.now();
  log("heal.cycle_start", { hysteresis_size: hysteresis.size });

  try {
    const instances = await fetchInstances();
    if (!Array.isArray(instances)) {
      log("heal.fatal", { error: "fetchInstances did not return array" });
      return NextResponse.json({ error: "Failed to fetch instances" }, { status: 500 });
    }

    const marketbet = getMarketbetProxy();
    const reportedOnline = instances.filter(
      (i: Record<string, unknown>) => i.connectionStatus === "open"
    );

    const staleChips: string[] = [];
    const staleSkipped: string[] = []; // detected but waiting for hysteresis
    const restartedChips: string[] = [];
    const onlineChips: Record<string, unknown>[] = [];

    // ============================================================
    // FASE 1 — Stale state detection (com histerese)
    // ============================================================
    await mapBatched(reportedOnline as Record<string, unknown>[], STATE_CHECK_CONCURRENCY, async (chip) => {
      const name = chip.name as string;
      const h = getHyst(name);
      try {
        const state = await getConnectionState(name);
        const actualState = state?.instance?.state || state?.state;
        if (actualState && actualState !== "open") {
          h.stale++;
          log("heal.phase1.stale_detected", { chip: name, actualState, count: h.stale, threshold: HYSTERESIS_THRESHOLD });
          if (h.stale >= HYSTERESIS_THRESHOLD) {
            staleChips.push(name);
            try {
              await restartInstance(name);
              restartedChips.push(name);
              log("heal.phase1.stale_restarted", { chip: name, count: h.stale });
              h.stale = 0; // reset apos acao
            } catch (e) {
              log("heal.phase1.stale_restart_failed", { chip: name, error: String(e).slice(0, 150) });
            }
          } else {
            staleSkipped.push(name);
            log("heal.phase1.stale_skipped_hysteresis", { chip: name, count: h.stale, threshold: HYSTERESIS_THRESHOLD });
            // adiciona pra Phase 2 mesmo assim — chip que pode ser stale ainda
            // precisa verificacao de proxy se reportou open
            onlineChips.push(chip);
          }
        } else {
          if (h.stale > 0) {
            log("heal.phase1.stale_recovered", { chip: name, previous_count: h.stale });
            h.stale = 0;
          }
          onlineChips.push(chip);
        }
      } catch (e) {
        log("heal.phase1.state_check_error", { chip: name, error: String(e).slice(0, 100) });
        onlineChips.push(chip);
      }
    });

    // ============================================================
    // FASE 2 — Proxy health (com histerese pra failed; orfao = imediato)
    // ============================================================
    const results: HealResult[] = await mapBatched(onlineChips, HEAL_CONCURRENCY, async (chip) => {
      const name = chip.name as string;
      const proxy = chip.Proxy as { enabled: boolean } | null;
      const h = getHyst(name);

      // Caso 1: ORFAO — sem proxy. Sem histerese, heal imediato.
      if (!proxy?.enabled) {
        log("heal.phase2.orphan", { chip: name });
        return await healOrphan(name, marketbet);
      }

      // Caso 2: tem proxy. Testa se funciona.
      try {
        const proxyConfig = await findProxy(name);
        const check = await checkProxyForInstance(name, proxyConfig);

        if (check && check.country === "BR") {
          if (h.proxy_failed > 0) {
            log("heal.phase2.proxy_recovered", { chip: name, previous_count: h.proxy_failed, ip: check.ip });
            h.proxy_failed = 0;
          }
          return { name, status: "healthy", ip: check.ip, city: check.city };
        }

        // Proxy falhou no teste.
        h.proxy_failed++;
        log("heal.phase2.proxy_failed", {
          chip: name,
          country: check?.country ?? "unreachable",
          count: h.proxy_failed,
          threshold: HYSTERESIS_THRESHOLD,
        });

        if (h.proxy_failed < HYSTERESIS_THRESHOLD) {
          log("heal.phase2.proxy_skipped_hysteresis", { chip: name, count: h.proxy_failed });
          return { name, status: "pending_hysteresis", detail: `proxy_failed count=${h.proxy_failed}/${HYSTERESIS_THRESHOLD}` };
        }

        // Atingiu threshold: heal de verdade.
        const isIPRoyal = proxyConfig?.host === process.env.PROXY_HOST;

        if (!isIPRoyal) {
          if (marketbet) {
            log("heal.phase2.reapply_marketbet", { chip: name });
            await setProxy(name, marketbet);
            await new Promise((r) => setTimeout(r, 400));
            await restartInstance(name);
            await new Promise((r) => setTimeout(r, 6000));
            const newConf = await findProxy(name);
            const recheck = await checkProxyForInstance(name, newConf);
            if (recheck && recheck.country === "BR") {
              log("heal.phase2.healed", { chip: name, ip: recheck.ip, city: recheck.city });
              h.proxy_failed = 0;
              return { name, status: "healed", ip: recheck.ip, city: recheck.city };
            }
          }
          log("heal.phase2.unreachable", { chip: name, detail: "manual proxy failed, heal nao resolveu" });
          return { name, status: "unreachable", detail: "manual proxy failed, heal nao resolveu" };
        }

        // IPRoyal — rotaciona session
        const oldPassword = proxyConfig?.password as string | undefined;
        const oldSession = oldPassword?.match(/session-(.+)$/)?.[1] || "unknown";
        await setProxy(name);
        const newConfig = await findProxy(name);
        const newSession = (newConfig?.password as string)?.match(/session-(.+)$/)?.[1] || "unknown";
        const recheck = await checkProxyForInstance(name, newConfig);
        if (recheck) h.proxy_failed = 0;
        log("heal.phase2.iproyal_rotated", { chip: name, oldSession, newSession, recheck_ok: !!recheck });
        return {
          name,
          status: recheck ? "healed" : "unreachable",
          ip: recheck?.ip,
          city: recheck?.city,
          oldSession,
          newSession,
        };
      } catch (e) {
        log("heal.phase2.error", { chip: name, error: String(e).slice(0, 100) });
        return { name, status: "unreachable", detail: String(e).slice(0, 100) };
      }
    });

    const healthy = results.filter((r) => r.status === "healthy").length;
    const healed = results.filter((r) => r.status === "healed").length;
    const orphanHealed = results.filter((r) => r.status === "orphan_healed").length;
    const unreachable = results.filter((r) => r.status === "unreachable").length;
    const pendingHysteresis = results.filter((r) => r.status === "pending_hysteresis").length;

    // ============================================================
    // FASE 3 — Zombie detection + quarantine (com histerese + circuit breaker)
    // ============================================================
    interface ZombieEntry {
      name: string;
      reason: string;
      restartAttempted: boolean;
      recovered: boolean;
      quarantined: boolean;
      hysteresis_count?: number;
      quarantine?: QuarantineResult["steps"];
    }
    const zombieDetection = {
      probed: 0,
      mass_failure: false,
      zombies: [] as ZombieEntry[],
    };
    const quarantinedNames = new Set<string>();

    // So probe chips que passaram pelo Phase 2 healthy/healed/orphan_healed.
    // pending_hysteresis nao probe — proxy estava ruim, nao adianta probar.
    const probeTargets = results
      .filter((r) => r.status === "healthy" || r.status === "healed" || r.status === "orphan_healed")
      .map((r) => r.name);

    // Candidatos a quarentena (zombie nao-recuperado que passou histerese).
    // NAO quarentenamos inline: coletamos primeiro pra aplicar o circuit breaker
    // de falha em massa (decisao pos-loop, abaixo).
    const quarantineCandidates: { name: string; entry: ZombieEntry }[] = [];

    await mapBatched(probeTargets, STATE_CHECK_CONCURRENCY, async (name) => {
      const h = getHyst(name);
      const probe = await probeChipSession(name);
      zombieDetection.probed++;
      if (probe.alive) {
        if (h.zombie > 0) {
          log("heal.phase3.zombie_recovered", { chip: name, previous_count: h.zombie });
          h.zombie = 0;
        }
        return;
      }

      h.zombie++;
      log("heal.phase3.zombie_detected", {
        chip: name,
        reason: probe.reason,
        count: h.zombie,
        threshold: HYSTERESIS_THRESHOLD,
      });

      // Tenta restart como recovery primaria (sempre, mesmo abaixo do threshold)
      let recovered = false;
      let restartAttempted = false;
      try {
        await restartInstance(name);
        restartAttempted = true;
        await new Promise((r) => setTimeout(r, 8000));
        const reprobe = await probeChipSession(name);
        recovered = reprobe.alive;
        log("heal.phase3.restart_result", { chip: name, recovered });
      } catch (e) {
        log("heal.phase3.restart_error", { chip: name, error: String(e).slice(0, 100) });
      }

      if (recovered) {
        h.zombie = 0;
        zombieDetection.zombies.push({
          name,
          reason: probe.reason,
          restartAttempted,
          recovered,
          quarantined: false,
          hysteresis_count: 0,
        });
        return;
      }

      // Nao recuperou. Quarentena so se passar threshold.
      if (h.zombie < HYSTERESIS_THRESHOLD) {
        log("heal.phase3.zombie_skipped_hysteresis", { chip: name, count: h.zombie });
        zombieDetection.zombies.push({
          name,
          reason: probe.reason,
          restartAttempted,
          recovered: false,
          quarantined: false,
          hysteresis_count: h.zombie,
        });
        return;
      }

      // Threshold de histerese atingido + restart falhou → CANDIDATO a quarentena.
      // A decisao final fica pro circuit breaker pos-loop (nao quarentena aqui).
      const entry: ZombieEntry = {
        name,
        reason: probe.reason,
        restartAttempted,
        recovered: false,
        quarantined: false,
        hysteresis_count: h.zombie,
      };
      zombieDetection.zombies.push(entry);
      quarantineCandidates.push({ name, entry });
    });

    // ----- Circuit breaker de falha em massa -----
    // Se muitos chips precisariam de quarentena no MESMO ciclo, quase sempre e
    // falha sistemica (container Evolution / proxy / push de versao do WhatsApp),
    // NAO N zombies independentes. Quarentena em massa apaga os inboxes e desliga
    // o Chatwoot de toda a frota — foi exatamente o teardown de 03/06/2026.
    // Nesse caso abortamos a quarentena e so alertamos: o estado e recuperavel
    // via restart do container (deep zombie), sem destruir a integracao.
    const massThreshold = Number(process.env.HEAL_MASS_FAILURE_THRESHOLD) || 3;
    const massRatioTrip =
      probeTargets.length > 0 &&
      quarantineCandidates.length >= Math.ceil(probeTargets.length * 0.5);
    const massFailure =
      quarantineCandidates.length >= massThreshold || massRatioTrip;

    if (massFailure && quarantineCandidates.length > 0) {
      zombieDetection.mass_failure = true;
      log("heal.phase3.mass_failure_detected", {
        candidates: quarantineCandidates.map((c) => c.name),
        count: quarantineCandidates.length,
        probed: probeTargets.length,
        abs_threshold: massThreshold,
        action: "quarantine_aborted",
      });
      // Nao zera histerese: continua contando pra agir quando voltar ao normal.
    } else {
      for (const { name, entry } of quarantineCandidates) {
        log("heal.phase3.quarantining", { chip: name, count: getHyst(name).zombie });
        const q = await quarantineZombie(name);
        quarantinedNames.add(name);
        log("heal.phase3.quarantined", {
          chip: name,
          steps: {
            disable_chatwoot: q.steps.disable_chatwoot.ok,
            logout: q.steps.logout.ok,
            delete_inbox: q.steps.delete_inbox.ok,
          },
        });
        entry.quarantined = true;
        entry.quarantine = q.steps;
        // Nao zera o contador — chip continua quarentenado.
      }
    }

    // ============================================================
    // FASE 4 — Inbox cleanup (Chatwoot only, sem tocar chip)
    //   4.1 Delete inbox orfa (chip nao existe)
    //   4.2 Delete inbox de chip em close + disable integration
    //   4.3 Dedup (mesmo chip com varias inboxes)
    // REMOVIDO: recreate inbox (Phase 4.3 antiga) — dead code agora que zombie
    //          recreate e bloqueado. So se chip Online perdeu inbox por bug,
    //          o setup manual via UI resolve.
    // REMOVIDO: resolveWmiConversations — movido pra /api/chips/wmi-resolve
    // ============================================================
    const inboxCleanup = {
      orphans_deleted: [] as string[],
      close_inboxes_deleted: [] as string[],
      duplicates_deleted: [] as { chip: string; kept_id: number; deleted_ids: number[] }[],
      errors: [] as { name: string; step: string; error: string }[],
    };

    try {
      const inboxData = await listInboxes();
      const allInboxes = (inboxData.payload ?? inboxData ?? []) as Array<{ id: number; name: string }>;
      const inboxesByChip = new Map<string, Array<{ id: number; name: string }>>();
      for (const inb of allInboxes) {
        const m = (inb.name || "").match(/^WhatsApp\s*-\s*(.+)$/);
        if (!m) continue;
        const chipName = m[1].trim();
        if (!inboxesByChip.has(chipName)) inboxesByChip.set(chipName, []);
        inboxesByChip.get(chipName)!.push(inb);
      }

      // Dedup
      const inboxMap = new Map<string, { id: number; name: string }>();
      for (const [chipName, list] of inboxesByChip) {
        if (list.length === 1) {
          inboxMap.set(chipName, list[0]);
          continue;
        }
        list.sort((a, b) => b.id - a.id);
        const kept = list[0];
        const toDelete = list.slice(1);
        const deletedIds: number[] = [];
        for (const inb of toDelete) {
          try {
            await deleteInbox(inb.id);
            deletedIds.push(inb.id);
          } catch (e) {
            inboxCleanup.errors.push({ name: chipName, step: "delete_duplicate", error: String(e).slice(0, 100) });
          }
        }
        if (deletedIds.length > 0) {
          inboxCleanup.duplicates_deleted.push({ chip: chipName, kept_id: kept.id, deleted_ids: deletedIds });
          log("heal.phase4.duplicates_deleted", { chip: chipName, kept_id: kept.id, count: deletedIds.length });
        }
        inboxMap.set(chipName, kept);
      }

      const chipsByName = new Map<string, Record<string, unknown>>();
      for (const c of instances as Record<string, unknown>[]) {
        chipsByName.set(c.name as string, c);
      }

      // 4.1 Orfas
      for (const [chipName, inb] of inboxMap) {
        if (!chipsByName.has(chipName)) {
          try {
            await deleteInbox(inb.id);
            inboxCleanup.orphans_deleted.push(chipName);
            inboxMap.delete(chipName);
            log("heal.phase4.orphan_deleted", { chip: chipName, inbox_id: inb.id });
          } catch (e) {
            inboxCleanup.errors.push({ name: chipName, step: "delete_orphan", error: String(e).slice(0, 100) });
          }
        }
      }

      // 4.2 Close
      for (const [chipName, chip] of chipsByName) {
        if (chip.connectionStatus !== "close") continue;
        const inb = inboxMap.get(chipName);
        if (!inb) continue;
        try {
          await setChatwoot(chipName, false);
        } catch (e) {
          inboxCleanup.errors.push({ name: chipName, step: "disable_chatwoot", error: String(e).slice(0, 100) });
        }
        try {
          await deleteInbox(inb.id);
          inboxCleanup.close_inboxes_deleted.push(chipName);
          inboxMap.delete(chipName);
          log("heal.phase4.close_inbox_deleted", { chip: chipName, inbox_id: inb.id });
        } catch (e) {
          inboxCleanup.errors.push({ name: chipName, step: "delete_close_inbox", error: String(e).slice(0, 100) });
        }
      }
    } catch (e) {
      inboxCleanup.errors.push({ name: "_general", step: "inbox_cleanup", error: String(e).slice(0, 200) });
      log("heal.phase4.fatal", { error: String(e).slice(0, 200) });
    }

    const duration = Date.now() - cycleStart;
    log("heal.cycle_done", {
      duration_ms: duration,
      total: instances.length,
      online: reportedOnline.length,
      healthy,
      healed,
      orphan_healed: orphanHealed,
      unreachable,
      pending_hysteresis: pendingHysteresis,
      stale_detected: staleChips.length,
      stale_skipped: staleSkipped.length,
      restarted: restartedChips.length,
      zombies_total: zombieDetection.zombies.length,
      zombies_quarantined: zombieDetection.zombies.filter((z) => z.quarantined).length,
      mass_failure: zombieDetection.mass_failure,
      hysteresis_size: hysteresis.size,
    });

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      total: instances.length,
      online: reportedOnline.length,
      checked: results.length,
      healthy,
      healed,
      orphan_healed: orphanHealed,
      unreachable,
      pending_hysteresis: pendingHysteresis,
      stale_detected: staleChips,
      stale_skipped: staleSkipped,
      restarted: restartedChips,
      marketbet_configured: !!marketbet,
      inbox_cleanup: inboxCleanup,
      zombie_detection: zombieDetection,
      hysteresis_threshold: HYSTERESIS_THRESHOLD,
      results,
    });
  } catch (error) {
    log("heal.fatal", { error: String(error).slice(0, 300) });
    return NextResponse.json(
      { error: "Proxy heal failed", details: String(error).slice(0, 300) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}
