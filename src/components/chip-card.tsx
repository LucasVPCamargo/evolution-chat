"use client";

import {
  Wifi,
  WifiOff,
  Shield,
  MessageSquare,
  Trash2,
  RefreshCw,
  Globe,
  Loader2,
} from "lucide-react";

export interface ProxyDetails {
  enabled?: boolean;
  host?: string;
  port?: string;
  protocol?: string;
  username?: string;
  password?: string;
}

interface ChipCardProps {
  name: string;
  number: string;
  status: string;
  proxy: boolean;
  proxyDetails: ProxyDetails | null;
  chatwoot: boolean;
  onDelete: (name: string) => void;
  onReset: (name: string, number: string, proxyDetails: ProxyDetails | null) => void;
}

export function ChipCard({
  name,
  number,
  status,
  proxy,
  proxyDetails,
  chatwoot,
  onDelete,
  onReset,
}: ChipCardProps) {
  const isOnline = status === "open";
  const isConnecting = status === "connecting";
  // chips em close ou connecting podem ser resetados.
  const canReset = !isOnline;

  const sessionMatch = proxyDetails?.password?.match(/session-(.+)$/);
  const sessionName = sessionMatch ? sessionMatch[1] : null;

  return (
    <div
      className={`group rounded-xl border p-5 transition-all ${
        isOnline
          ? "border-emerald-500/15 bg-zinc-900/80"
          : isConnecting
            ? "border-amber-500/15 bg-zinc-900/80"
            : "border-red-500/15 bg-zinc-900/80"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`rounded-lg p-2.5 ${isOnline ? "bg-emerald-500/10" : isConnecting ? "bg-amber-500/10" : "bg-red-500/10"}`}>
            {isOnline ? (
              <Wifi className="h-5 w-5 text-emerald-400" />
            ) : isConnecting ? (
              <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
            ) : (
              <WifiOff className="h-5 w-5 text-red-400" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-white">{name}</h3>
            <p className="text-sm text-zinc-500">
              {number ? `+${number.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "$1 $2 $3-$4")}` : "Sem numero"}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            isOnline
              ? "bg-emerald-500/15 text-emerald-400"
              : isConnecting
                ? "bg-amber-500/15 text-amber-400"
                : "bg-red-500/15 text-red-400"
          }`}
        >
          {isOnline ? "Online" : isConnecting ? "Conectando..." : status || "Offline"}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className={`h-1.5 w-1.5 rounded-full ${proxy ? "bg-emerald-400" : "bg-zinc-600"}`} />
          <Shield className={`h-3 w-3 ${proxy ? "text-zinc-400" : "text-zinc-600"}`} />
          <span className={proxy ? "text-zinc-400" : "text-zinc-600"}>Proxy</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`h-1.5 w-1.5 rounded-full ${chatwoot ? "bg-emerald-400" : "bg-zinc-600"}`} />
          <MessageSquare className={`h-3 w-3 ${chatwoot ? "text-zinc-400" : "text-zinc-600"}`} />
          <span className={chatwoot ? "text-zinc-400" : "text-zinc-600"}>Chatwoot</span>
        </div>
      </div>

      {proxy && proxyDetails && (
        <div className="mt-3 rounded-lg bg-zinc-800/60 px-3 py-2 text-xs">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Globe className="h-3 w-3" />
            <span className="font-medium">Proxy</span>
            <span className="text-zinc-600">|</span>
            <span className="font-mono text-zinc-500">
              {proxyDetails.host}:{proxyDetails.port}
            </span>
          </div>
          {sessionName && (
            <div className="mt-1 text-zinc-500">
              Sessao: <span className="font-mono text-zinc-400">{sessionName}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {canReset && (
          <button
            onClick={() => onReset(name, number, proxyDetails)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25"
            title="Deleta a instancia e cria de novo (gera novo pairing code; mantem o mesmo nome e numero)"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Resetar
          </button>
        )}
        <button
          onClick={() => onDelete(name)}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remover
        </button>
      </div>
    </div>
  );
}
