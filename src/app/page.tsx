"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, LogOut, Copy, Check, X } from "lucide-react";
import { ChipCard, type ProxyDetails } from "@/components/chip-card";
import { ConnectModal } from "@/components/connect-modal";
import { StatsBar } from "@/components/stats-bar";

interface Chip {
  name: string;
  number: string;
  connectionStatus: string;
  Proxy: { enabled: boolean } | null;
  Chatwoot: { enabled: boolean } | null;
  proxyDetails: ProxyDetails | null;
}

export default function Dashboard() {
  const { status } = useSession();
  const router = useRouter();
  const [chips, setChips] = useState<Chip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resetState, setResetState] = useState<{
    name: string;
    number: string;
    proxyDetails: ProxyDetails | null;
    pairingCode: string | null;
    loading: boolean;
    error: string | null;
    finishing: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<{ healthy: boolean; services: { service: string; ok: boolean; latencyMs: number; detail?: string; ip?: string; country?: string; city?: string }[]; timestamp: string } | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  const loadChips = useCallback(async () => {
    try {
      const res = await fetch("/api/chips");
      const data = await res.json();
      setChips(Array.isArray(data) ? data : []);
    } catch {
      setChips([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setHealth(data);
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    loadChips();
    loadHealth();
    const refresh = setInterval(() => { loadChips(); loadHealth(); }, 30000);
    return () => clearInterval(refresh);
  }, [status, loadChips, loadHealth]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-zinc-500" />
      </main>
    );
  }

  function handleRefresh() {
    setRefreshing(true);
    setHealthLoading(true);
    loadChips();
    loadHealth();
  }

  function proxyDetailsToManual(p: ProxyDetails | null) {
    if (!p?.host || !p?.port || !p?.username || !p?.password) return undefined;
    return {
      host: p.host,
      port: p.port,
      username: p.username,
      password: p.password,
      protocol: p.protocol,
    };
  }

  async function handleReset(name: string, number: string, proxyDetails: ProxyDetails | null) {
    if (!confirm(`Resetar ${name}?\nVai deletar a instancia (e o inbox do Chatwoot) e criar do zero. Voce vai receber um novo codigo de pareamento.`)) return;
    setResetState({ name, number, proxyDetails, pairingCode: null, loading: true, error: null, finishing: false });
    try {
      // Step 1: delete tudo (chip + inbox Chatwoot)
      await fetch("/api/chips/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      // Step 2: cria de novo igual fluxo normal — devolve pairing code em 2-3s
      const connectRes = await fetch("/api/chips/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, number }),
      });
      const connectData = await connectRes.json();
      if (!connectRes.ok || !connectData.pairingCode) {
        setResetState((prev) => prev && { ...prev, loading: false, error: connectData.error || "Falha ao gerar codigo" });
        return;
      }
      setResetState((prev) => prev && { ...prev, loading: false, pairingCode: connectData.pairingCode });
    } catch (e) {
      setResetState((prev) => prev && { ...prev, loading: false, error: `Erro: ${String(e).slice(0, 100)}` });
    }
  }

  function handleCopyResetCode() {
    if (resetState?.pairingCode) {
      navigator.clipboard.writeText(resetState.pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Apos user clicar "Pronto, Conectei!" no reset: roda setup pra restaurar proxy
  // (manual se chip tinha; senao IPRoyal default) + Chatwoot inbox novo.
  async function finishReset() {
    if (!resetState) return;
    setResetState({ ...resetState, finishing: true });
    try {
      const body: Record<string, unknown> = { name: resetState.name };
      const manualProxy = proxyDetailsToManual(resetState.proxyDetails);
      if (manualProxy) body.manualProxy = manualProxy;
      await fetch("/api/chips/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { /* setup eh best-effort */ }
    setResetState(null);
    loadChips();
  }

  async function handleDelete(name: string) {
    if (!confirm(`Remover ${name}? Esta acao nao pode ser desfeita.`)) return;
    await fetch("/api/chips/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    loadChips();
  }

  const online = chips.filter((c) => c.connectionStatus === "open").length;
  const connecting = chips.filter((c) => c.connectionStatus === "connecting").length;
  const offline = chips.filter((c) => c.connectionStatus !== "open" && c.connectionStatus !== "connecting").length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Evolution Chat</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Gerenciamento de chips WhatsApp
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => signOut()}
            className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </button>
          <button
            onClick={() => setShowConnect(true)}
            disabled={!health?.services?.find((s) => s.service === "evolution")?.ok}
            title={!health?.services?.find((s) => s.service === "evolution")?.ok ? "Evolution API indisponivel" : ""}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              health?.services?.find((s) => s.service === "evolution")?.ok
                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                : "cursor-not-allowed bg-zinc-800 text-zinc-600"
            }`}
          >
            <Plus className="h-4 w-4" />
            Novo Chip
          </button>
        </div>
      </div>

      <div className="mb-6">
        <StatsBar total={chips.length} online={online} connecting={connecting} offline={offline} health={health} healthLoading={healthLoading} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-zinc-600" />
        </div>
      ) : chips.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 py-20">
          <p className="text-zinc-500">Nenhum chip conectado</p>
          <button
            onClick={() => setShowConnect(true)}
            className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            Conectar primeiro chip
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {chips.map((chip) => (
            <ChipCard
              key={chip.name}
              name={chip.name}
              number={chip.number}
              status={chip.connectionStatus}
              proxy={!!chip.Proxy?.enabled}
              proxyDetails={chip.proxyDetails}
              chatwoot={!!chip.Chatwoot?.enabled}
              onDelete={handleDelete}
              onReset={handleReset}
            />
          ))}
        </div>
      )}

      {showConnect && (
        <ConnectModal
          onClose={() => setShowConnect(false)}
          onSuccess={loadChips}
        />
      )}

      {resetState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {resetState.pairingCode ? `Resetar ${resetState.name}` : `Resetando ${resetState.name}...`}
              </h2>
              <button
                onClick={() => { setResetState(null); loadChips(); }}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              {resetState.loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-400">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Deletando e recriando...
                </div>
              ) : resetState.error ? (
                <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{resetState.error}</p>
              ) : resetState.pairingCode ? (
                <>
                  <p className="text-sm text-zinc-400">Digite este codigo no WhatsApp do celular:</p>
                  <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-3">
                    <span className="font-mono text-2xl font-bold tracking-widest text-emerald-400">
                      {resetState.pairingCode}
                    </span>
                    <button
                      onClick={handleCopyResetCode}
                      className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800"
                    >
                      {copied ? <Check className="h-5 w-5 text-emerald-400" /> : <Copy className="h-5 w-5" />}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500">
                    No celular: WhatsApp &gt; Dispositivos conectados &gt; Conectar dispositivo &gt; Conectar com numero de telefone
                  </p>
                  <p className="text-xs text-amber-400">
                    Voce tem 40 segundos para usar o codigo antes de expirar
                  </p>
                  <button
                    onClick={finishReset}
                    disabled={resetState.finishing}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {resetState.finishing ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Configurando proxy e Chatwoot...
                      </>
                    ) : (
                      "Pronto, Conectei!"
                    )}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
