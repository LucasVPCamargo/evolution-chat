"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, LogOut, Copy, Check, X } from "lucide-react";
import { ChipCard } from "@/components/chip-card";
import { ConnectModal } from "@/components/connect-modal";
import { StatsBar } from "@/components/stats-bar";

interface ProxyDetails {
  enabled?: boolean;
  host?: string;
  port?: string;
  protocol?: string;
  username?: string;
  password?: string;
}

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
  const [reconnectCode, setReconnectCode] = useState<string | null>(null);
  const [reconnectName, setReconnectName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<{ healthy: boolean; services: { service: string; ok: boolean; latencyMs: number; detail?: string; ip?: string; country?: string; city?: string }[]; timestamp: string } | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [lastHeal, setLastHeal] = useState<{ healed: number; unreachable: number; timestamp: string } | null>(null);

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

  const runProxyHeal = useCallback(async () => {
    try {
      const res = await fetch("/api/chips/proxy-heal", { method: "POST" });
      const data = await res.json();
      setLastHeal({ healed: data.healed, unreachable: data.unreachable, timestamp: data.timestamp });
      if (data.healed > 0 || (data.staleDetected && data.staleDetected.length > 0)) loadChips();
    } catch { /* silent */ }
  }, [loadChips]);

  useEffect(() => {
    if (status !== "authenticated") return;
    loadChips();
    loadHealth();
    const refresh = setInterval(() => { loadChips(); loadHealth(); }, 30000);
    // Auto-heal proxies a cada 5 minutos
    const healTimer = setTimeout(() => runProxyHeal(), 10000); // primeira vez 10s após load
    const healInterval = setInterval(runProxyHeal, 5 * 60 * 1000);
    return () => { clearInterval(refresh); clearTimeout(healTimer); clearInterval(healInterval); };
  }, [status, loadChips, loadHealth, runProxyHeal]);

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

  async function handleRestart(name: string) {
    await fetch("/api/chips/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setTimeout(loadChips, 3000);
  }

  async function handleReconnect(name: string) {
    try {
      const res = await fetch("/api/chips/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      const code = data.pairingCode;
      if (code) {
        setReconnectName(name);
        setReconnectCode(code);
      }
    } catch {
      // ignore
    }
  }

  function handleCopyCode() {
    if (reconnectCode) {
      navigator.clipboard.writeText(reconnectCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
  const offline = chips.filter((c) => c.connectionStatus !== "open").length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
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
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Atualizar
          </button>
          <button
            onClick={() => setShowConnect(true)}
            disabled={!health?.healthy}
            title={!health?.healthy ? "Servicos indisponiveis — verifique o status" : ""}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              health?.healthy
                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                : "cursor-not-allowed bg-zinc-800 text-zinc-600"
            }`}
          >
            <Plus className="h-4 w-4" />
            Novo Chip
          </button>
        </div>
      </div>

      {/* Stats + Health */}
      <div className="mb-6">
        <StatsBar total={chips.length} online={online} offline={offline} health={health} healthLoading={healthLoading} lastHeal={lastHeal} />
      </div>

      {/* Chip Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-zinc-600" />
        </div>
      ) : chips.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 py-20">
          <p className="text-zinc-500">Nenhum chip conectado</p>
          <button
            onClick={() => setShowConnect(true)}
            disabled={!health?.healthy}
            className={`mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              health?.healthy
                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                : "cursor-not-allowed bg-zinc-800 text-zinc-600"
            }`}
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
              onRestart={handleRestart}
              onDelete={handleDelete}
              onReconnect={handleReconnect}
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

      {reconnectCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Reconectar {reconnectName}
              </h2>
              <button
                onClick={() => { setReconnectCode(null); setReconnectName(null); }}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <p className="text-sm text-zinc-400">
                Digite este codigo no WhatsApp do celular:
              </p>
              <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-3">
                <span className="font-mono text-2xl font-bold tracking-widest text-emerald-400">
                  {reconnectCode}
                </span>
                <button
                  onClick={handleCopyCode}
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
                onClick={() => { setReconnectCode(null); setReconnectName(null); loadChips(); }}
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
              >
                Pronto, Conectei!
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
