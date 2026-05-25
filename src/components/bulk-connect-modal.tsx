"use client";

import { useState } from "react";
import { X, Loader2, Copy, Check, RefreshCw, ChevronRight, CheckCircle2, AlertTriangle } from "lucide-react";

interface BulkConnectModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

type ChipItem = {
  name: string;
  number: string;
  status: "pending" | "active" | "paired" | "done" | "skipped" | "error";
  pairingCode: string | null;
  error: string | null;
};

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const NUMBER_PATTERN = /^\d{12,14}$/;

// Parse "nome,numero" por linha. Aceita virgula, ponto-e-virgula ou tab como separador.
// Skipa linhas vazias e comentarios (que comecam com #).
function parseList(input: string): { ok: ChipItem[]; bad: { raw: string; reason: string }[] } {
  const ok: ChipItem[] = [];
  const bad: { raw: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/[,;\t]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      bad.push({ raw: line, reason: "formato invalido (esperado: nome,numero)" });
      continue;
    }
    const [name, number] = parts;
    if (!NAME_PATTERN.test(name)) {
      bad.push({ raw: line, reason: `nome "${name}" invalido (use A-Z 0-9 _ -)` });
      continue;
    }
    if (!NUMBER_PATTERN.test(number)) {
      bad.push({ raw: line, reason: `numero "${number}" invalido (12-14 digitos)` });
      continue;
    }
    if (seen.has(name)) {
      bad.push({ raw: line, reason: `nome "${name}" duplicado` });
      continue;
    }
    seen.add(name);
    ok.push({ name, number, status: "pending", pairingCode: null, error: null });
  }
  return { ok, bad };
}

export function BulkConnectModal({ onClose, onSuccess }: BulkConnectModalProps) {
  const [stage, setStage] = useState<"input" | "queue">("input");
  const [inputText, setInputText] = useState("");
  const [parseErrors, setParseErrors] = useState<{ raw: string; reason: string }[]>([]);
  const [items, setItems] = useState<ChipItem[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [copied, setCopied] = useState(false);

  function handleStart() {
    const { ok, bad } = parseList(inputText);
    setParseErrors(bad);
    if (ok.length === 0) return;
    setItems(ok);
    setStage("queue");
    // Inicia primeiro automaticamente.
    void startNext(ok, 0);
  }

  async function startNext(currentItems: ChipItem[], idx: number) {
    if (idx >= currentItems.length) return;
    setActiveIndex(idx);
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, status: "active" } : it)));
    const it = currentItems[idx];
    try {
      const res = await fetch("/api/chips/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: it.name, number: it.number }),
      });
      const data = await res.json();
      if (!res.ok || !data.pairingCode) {
        setItems((prev) =>
          prev.map((x, i) =>
            i === idx ? { ...x, status: "error", error: data.error || "Falha ao gerar codigo" } : x,
          ),
        );
        return;
      }
      setItems((prev) =>
        prev.map((x, i) => (i === idx ? { ...x, status: "paired", pairingCode: data.pairingCode } : x)),
      );
    } catch (e) {
      setItems((prev) =>
        prev.map((x, i) =>
          i === idx ? { ...x, status: "error", error: String(e).slice(0, 100) } : x,
        ),
      );
    }
  }

  async function handlePaired() {
    if (activeIndex < 0) return;
    const it = items[activeIndex];
    if (!it) return;
    setItems((prev) => prev.map((x, i) => (i === activeIndex ? { ...x, status: "done" } : x)));
    // setup roda em background, nao bloqueia avanco da fila
    void fetch("/api/chips/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: it.name }),
    }).catch(() => null);
    // Avanca pro proximo
    const next = activeIndex + 1;
    if (next < items.length) {
      void startNext(items, next);
    } else {
      setActiveIndex(-1);
    }
  }

  function handleSkip() {
    if (activeIndex < 0) return;
    setItems((prev) => prev.map((x, i) => (i === activeIndex ? { ...x, status: "skipped" } : x)));
    const next = activeIndex + 1;
    if (next < items.length) {
      void startNext(items, next);
    } else {
      setActiveIndex(-1);
    }
  }

  function handleRetry() {
    if (activeIndex < 0) return;
    void startNext(items, activeIndex);
  }

  function handleCopy(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleClose() {
    onSuccess();
    onClose();
  }

  const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
  const doneCount = items.filter((i) => i.status === "done").length;
  const errorCount = items.filter((i) => i.status === "error").length;
  const skippedCount = items.filter((i) => i.status === "skipped").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {stage === "input" ? "Conectar em Lote" : `Fila: ${doneCount}/${items.length} pareados`}
          </h2>
          <button onClick={handleClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {stage === "input" ? (
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-zinc-400">
                Cole a lista de chips (uma por linha)
              </label>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                rows={12}
                placeholder={"VIPA220,5511999999999\nVIPA221,5511888888888\n# linhas comecadas com # sao ignoradas"}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Formato: <code className="text-zinc-400">nome,numero</code> (separadores: virgula, ponto-e-virgula ou tab). Numero com DDI+DDD+numero (sem espacos).
              </p>
            </div>

            {parseErrors.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
                <p className="mb-1 text-xs font-medium text-amber-300">
                  {parseErrors.length} linha(s) com problema (serao puladas):
                </p>
                <ul className="space-y-0.5 text-xs text-amber-200/80">
                  {parseErrors.slice(0, 5).map((e, i) => (
                    <li key={i}>
                      <code className="text-amber-100/60">{e.raw}</code> — {e.reason}
                    </li>
                  ))}
                  {parseErrors.length > 5 && <li>... e mais {parseErrors.length - 5}</li>}
                </ul>
              </div>
            )}

            <div className="rounded-lg bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400">
              <p className="font-medium text-zinc-300">Como funciona</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-zinc-500">
                <li>A fila gera 1 pairing code de cada vez (Evolution nao suporta paralelo seguro)</li>
                <li>Voce pareia no celular, clica &quot;Pareei, proximo&quot; e a fila avanca</li>
                <li>O setup (proxy IPRoyal + Chatwoot + restart) roda em background apos cada pareamento</li>
                <li>Pula chip se quiser (botao Pular); pode tentar de novo se der erro</li>
              </ul>
            </div>

            <button
              onClick={handleStart}
              disabled={!inputText.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              Iniciar fila ({parseList(inputText).ok.length} chips)
            </button>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-[1fr_1fr] gap-4">
            <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: "60vh" }}>
              {items.map((it, i) => (
                <div
                  key={it.name}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                    i === activeIndex
                      ? "border-emerald-500/30 bg-emerald-950/20"
                      : it.status === "done"
                        ? "border-zinc-800 bg-zinc-900/40 text-zinc-500"
                        : it.status === "error"
                          ? "border-red-500/20 bg-red-950/10"
                          : it.status === "skipped"
                            ? "border-zinc-800 bg-zinc-900/40 text-zinc-600"
                            : "border-zinc-800 bg-zinc-900/40"
                  }`}
                >
                  {it.status === "active" ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-400" />
                  ) : it.status === "paired" ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : it.status === "done" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/70" />
                  ) : it.status === "error" ? (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                  ) : it.status === "skipped" ? (
                    <X className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                  ) : (
                    <div className="h-3.5 w-3.5 shrink-0 rounded-full border border-zinc-700" />
                  )}
                  <span className="flex-1 font-mono text-zinc-300">{it.name}</span>
                  <span className="font-mono text-[10px] text-zinc-600">{it.number}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col justify-center rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              {!activeItem ? (
                <div className="space-y-3 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
                  <p className="text-sm font-medium text-white">Fila concluida</p>
                  <p className="text-xs text-zinc-500">
                    {doneCount} OK · {errorCount} erro · {skippedCount} pulados
                  </p>
                  <button
                    onClick={handleClose}
                    className="mt-2 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                  >
                    Fechar
                  </button>
                </div>
              ) : activeItem.status === "active" ? (
                <div className="space-y-3 text-center">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-400" />
                  <p className="text-sm text-white">
                    Gerando code para <span className="font-mono text-emerald-400">{activeItem.name}</span>...
                  </p>
                  <p className="text-xs text-zinc-500">{activeItem.number}</p>
                </div>
              ) : activeItem.status === "paired" && activeItem.pairingCode ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-zinc-500">
                      Pareando: <span className="font-mono text-zinc-300">{activeItem.name}</span>
                      {" · "}
                      <span className="font-mono">{activeItem.number}</span>
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-3">
                    <span className="font-mono text-2xl font-bold tracking-widest text-emerald-400">
                      {activeItem.pairingCode}
                    </span>
                    <button
                      onClick={() => handleCopy(activeItem.pairingCode!)}
                      className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800"
                    >
                      {copied ? <Check className="h-5 w-5 text-emerald-400" /> : <Copy className="h-5 w-5" />}
                    </button>
                  </div>
                  <p className="text-xs text-amber-400">~40s antes de expirar</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handlePaired}
                      className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-medium text-white hover:bg-emerald-500"
                    >
                      Pareei, proximo
                    </button>
                    <button
                      onClick={handleSkip}
                      className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-700"
                    >
                      Pular
                    </button>
                  </div>
                </div>
              ) : activeItem.status === "error" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <span className="text-sm text-red-300">Erro em {activeItem.name}</span>
                  </div>
                  <p className="rounded-lg bg-red-900/20 px-3 py-2 text-xs text-red-300">{activeItem.error}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleRetry}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 py-2 text-xs font-medium text-white hover:bg-emerald-500"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Tentar de novo
                    </button>
                    <button
                      onClick={handleSkip}
                      className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-700"
                    >
                      Pular
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
