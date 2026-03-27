"use client";

import {
  Wifi,
  WifiOff,
  Shield,
  MessageSquare,
  Trash2,
  RotateCw,
  Link,
} from "lucide-react";

interface ChipCardProps {
  name: string;
  number: string;
  status: string;
  proxy: boolean;
  chatwoot: boolean;
  onRestart: (name: string) => void;
  onDelete: (name: string) => void;
  onReconnect: (name: string) => void;
}

export function ChipCard({
  name,
  number,
  status,
  proxy,
  chatwoot,
  onRestart,
  onDelete,
  onReconnect,
}: ChipCardProps) {
  const isOnline = status === "open";
  const isClosed = status === "close";

  return (
    <div
      className={`group rounded-xl border p-5 transition-all ${
        isOnline
          ? "border-emerald-500/15 bg-zinc-900/80"
          : "border-red-500/15 bg-zinc-900/80"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`rounded-lg p-2.5 ${isOnline ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
            {isOnline ? (
              <Wifi className="h-5 w-5 text-emerald-400" />
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
              : "bg-red-500/15 text-red-400"
          }`}
        >
          {isOnline ? "Online" : status || "Offline"}
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

      <div className="mt-4 flex gap-2">
        {isClosed && (
          <button
            onClick={() => onReconnect(name)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25"
          >
            <Link className="h-3.5 w-3.5" />
            Reconectar
          </button>
        )}
        <button
          onClick={() => onRestart(name)}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Reiniciar
        </button>
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
