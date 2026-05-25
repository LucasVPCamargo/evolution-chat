"use client";

import { useEffect, useState } from "react";
import {
  X,
  Loader2,
  Copy,
  Check,
  Shield,
  Wifi,
  Server,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

interface ServiceHealth {
  service: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

interface ConnectModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function ConnectModal({ onClose, onSuccess }: ConnectModalProps) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [precheck, setPrecheck] = useState<"checking" | "ok" | "failed">("checking");
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [proxyMode, setProxyMode] = useState<"auto" | "manual">("auto");
  const [manualProxyStr, setManualProxyStr] = useState("");

  const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
  const nameInvalid = name.length > 0 && !NAME_PATTERN.test(name);

  useEffect(() => {
    runPrecheck();
  }, []);

  async function runPrecheck() {
    setPrecheck("checking");
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setServices(data.services || []);
      setPrecheck(data.healthy ? "ok" : "failed");
    } catch {
      setPrecheck("failed");
      setServices([]);
    }
  }

  const serviceIcons: Record<string, typeof Server> = {
    evolution: Server,
    chatwoot: MessageSquare,
    proxy: Shield,
  };

  const serviceLabels: Record<string, string> = {
    evolution: "Evolution API",
    chatwoot: "Chatwoot",
    proxy: "Proxy BR",
  };

  async function handleConnect() {
    setLoading(true);
    setError(null);
    setStep("Gerando codigo de pareamento...");

    try {
      const res = await fetch("/api/chips/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, number }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erro ao conectar");
        return;
      }

      if (data.pairingCode) {
        setPairingCode(data.pairingCode);
      } else {
        setError("Nao foi possivel gerar o codigo de pareamento");
      }
    } catch {
      setError("Timeout — tente novamente");
    } finally {
      setLoading(false);
      setStep("");
    }
  }

  function handleCopy() {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const [finishing, setFinishing] = useState(false);

  function parseProxyString(str: string) {
    const parts = str.trim().split(":");
    if (parts.length !== 4) return null;
    return { host: parts[0], port: parts[1], username: parts[2], password: parts[3] };
  }

  async function runSetup() {
    if (!name) return;
    try {
      const body: Record<string, unknown> = { name };
      if (proxyMode === "manual") {
        const parsed = parseProxyString(manualProxyStr);
        if (parsed) body.manualProxy = parsed;
      }
      await fetch("/api/chips/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // Setup errors are non-fatal — chip is already connected
    }
  }

  async function handleDone() {
    setFinishing(true);
    await runSetup();
    setFinishing(false);
    onSuccess();
    onClose();
  }

  async function handleCloseModal() {
    // If pairing code was shown, run setup even if closing with X
    if (pairingCode && name) {
      runSetup(); // fire-and-forget
    }
    onSuccess();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {pairingCode ? "Codigo de Pareamento" : "Conectar Novo Chip"}
          </h2>
          <button
            onClick={handleCloseModal}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!pairingCode ? (
          <div className="mt-5 space-y-4">
            {/* Pre-check status */}
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <p className="text-xs font-medium text-zinc-400">Pre-check dos servicos</p>
              {precheck === "checking" ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
                  <span className="text-xs text-zinc-500">Verificando...</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {services.map((svc) => {
                    const Icon = serviceIcons[svc.service] || Server;
                    const label = serviceLabels[svc.service] || svc.service;
                    return (
                      <div key={svc.service} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className={`h-3.5 w-3.5 ${svc.ok ? "text-emerald-400" : "text-red-400"}`} />
                          <span className={`text-xs ${svc.ok ? "text-emerald-300" : "text-red-300"}`}>{label}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {svc.ok ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                          )}
                          <span className={`text-xs ${svc.ok ? "text-emerald-500" : "text-red-500"}`}>
                            {svc.ok ? `OK (${svc.latencyMs}ms)` : svc.detail || "Erro"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {precheck === "failed" && (
                    <button
                      onClick={runPrecheck}
                      className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      Tentar novamente
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-zinc-400">
                Nome da instancia
              </label>
              <input
                type="text"
                placeholder="chip03"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={precheck !== "ok"}
                className={`w-full rounded-lg border bg-zinc-800 px-3 py-2 text-white placeholder:text-zinc-500 focus:outline-none disabled:opacity-50 ${
                  nameInvalid ? "border-red-500 focus:border-red-500" : "border-zinc-700 focus:border-emerald-500"
                }`}
              />
              {nameInvalid ? (
                <p className="mt-1 text-xs text-red-400">
                  Use apenas letras, numeros, _ ou - (sem espacos)
                </p>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">
                  Ex: SPAM-A02, VIP_A76, chip03
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-zinc-400">
                Numero do WhatsApp
              </label>
              <input
                type="text"
                placeholder="5511999999999"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                disabled={precheck !== "ok"}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Formato: DDI + DDD + numero (sem espacos ou tracos)
              </p>
            </div>

            {/* Proxy mode selector */}
            <div className="space-y-2">
              <label className="mb-1.5 block text-sm text-zinc-400">Proxy</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setProxyMode("auto")}
                  disabled={precheck !== "ok"}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    proxyMode === "auto"
                      ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-400"
                      : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  <Shield className="mx-auto mb-1 h-4 w-4" />
                  IPRoyal (auto)
                </button>
                <button
                  type="button"
                  onClick={() => setProxyMode("manual")}
                  disabled={precheck !== "ok"}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    proxyMode === "manual"
                      ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-400"
                      : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  <Shield className="mx-auto mb-1 h-4 w-4" />
                  Proxy Manual
                </button>
              </div>
              {proxyMode === "auto" ? (
                <p className="text-xs text-emerald-300/70">
                  Proxy residencial brasileiro (IPRoyal) configurado automaticamente
                </p>
              ) : (
                <div>
                  <input
                    type="text"
                    placeholder="host:porta:usuario:senha"
                    value={manualProxyStr}
                    onChange={(e) => setManualProxyStr(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Formato: host:porta:usuario:senha
                  </p>
                </div>
              )}
            </div>

            {error && (
              <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            )}

            <button
              onClick={handleConnect}
              disabled={loading || !name || nameInvalid || !number || precheck !== "ok" || (proxyMode === "manual" && !manualProxyStr.includes(":"))}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {step || "Configurando..."}
                </>
              ) : (
                "Conectar Chip"
              )}
            </button>

            {loading && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Wifi className="h-3 w-3" />
                  <span>Criando instancia → Proxy → Pairing code → Chatwoot</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full animate-pulse rounded-full bg-emerald-500/60" style={{ width: "60%" }} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2">
              <Shield className="h-4 w-4 shrink-0 text-emerald-400" />
              <p className="text-xs text-emerald-300">
                {proxyMode === "auto"
                  ? "Proxy residencial BR (IPRoyal) sera configurado automaticamente"
                  : `Proxy manual: ${manualProxyStr.split(":").slice(0, 2).join(":")}`}
              </p>
            </div>
            <p className="text-sm text-zinc-400">
              Digite este codigo no WhatsApp do celular:
            </p>
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-3">
              <span className="font-mono text-2xl font-bold tracking-widest text-emerald-400">
                {pairingCode}
              </span>
              <button
                onClick={handleCopy}
                className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800"
              >
                {copied ? (
                  <Check className="h-5 w-5 text-emerald-400" />
                ) : (
                  <Copy className="h-5 w-5" />
                )}
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              No celular: WhatsApp &gt; Dispositivos conectados &gt; Conectar dispositivo &gt; Conectar com numero de telefone
            </p>
            <p className="text-xs text-amber-400">
              Voce tem 40 segundos para usar o codigo antes de expirar
            </p>
            <button
              onClick={handleDone}
              disabled={finishing}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {finishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Configurando proxy e Chatwoot...
                </>
              ) : (
                "Pronto, Conectei!"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
