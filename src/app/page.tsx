"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { ChipCard } from "@/components/chip-card";
import { ConnectModal } from "@/components/connect-modal";
import { StatsBar } from "@/components/stats-bar";

interface Chip {
  name: string;
  number: string;
  connectionStatus: string;
  Proxy: { enabled: boolean } | null;
  Chatwoot: { enabled: boolean } | null;
}

export default function Dashboard() {
  const [chips, setChips] = useState<Chip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  useEffect(() => {
    loadChips();
    const interval = setInterval(loadChips, 30000);
    return () => clearInterval(interval);
  }, [loadChips]);

  function handleRefresh() {
    setRefreshing(true);
    loadChips();
  }

  async function handleRestart(name: string) {
    await fetch("/api/chips/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restart", name }),
    });
    setTimeout(loadChips, 3000);
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
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Evolution Chat</h1>
          <p className="text-sm text-zinc-500">
            Gerenciamento de chips WhatsApp
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Atualizar
          </button>
          <button
            onClick={() => setShowConnect(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            Novo Chip
          </button>
        </div>
      </div>

      <div className="mb-8">
        <StatsBar total={chips.length} online={online} offline={offline} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      ) : chips.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-700 py-20">
          <p className="text-zinc-500">Nenhum chip conectado</p>
          <button
            onClick={() => setShowConnect(true)}
            className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
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
              chatwoot={!!chip.Chatwoot?.enabled}
              onRestart={handleRestart}
              onDelete={handleDelete}
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
    </main>
  );
}
