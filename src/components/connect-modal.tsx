"use client";

import { useState } from "react";
import { X, Loader2, Copy, Check } from "lucide-react";

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

  async function handleConnect() {
    setLoading(true);
    setError(null);
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

      const code = data.pairingCode || data.connection?.pairingCode || data.connection?.code;
      if (code) {
        setPairingCode(code);
      } else {
        onSuccess();
        onClose();
      }
    } catch {
      setError("Erro de conexao com o servidor");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleDone() {
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
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!pairingCode ? (
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-zinc-400">
                Nome da instancia
              </label>
              <input
                type="text"
                placeholder="chip03"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
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
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Formato: DDI + DDD + numero (sem espacos ou tracos)
              </p>
            </div>

            {error && (
              <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            )}

            <button
              onClick={handleConnect}
              disabled={loading || !name || !number}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Configurando...
                </>
              ) : (
                "Conectar Chip"
              )}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
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
            <button
              onClick={handleDone}
              className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
            >
              Pronto, Conectei!
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
