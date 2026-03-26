"use client";

import {
  Wifi,
  WifiOff,
  Shield,
  MessageSquare,
  Trash2,
  RotateCw,
} from "lucide-react";

interface ChipCardProps {
  name: string;
  number: string;
  status: string;
  proxy: boolean;
  chatwoot: boolean;
  onRestart: (name: string) => void;
  onDelete: (name: string) => void;
}

export function ChipCard({
  name,
  number,
  status,
  proxy,
  chatwoot,
  onRestart,
  onDelete,
}: ChipCardProps) {
  const isOnline = status === "open";

  return (
    <div
      className={`rounded-xl border p-5 transition-all ${
        isOnline
          ? "border-emerald-500/30 bg-emerald-950/20"
          : "border-red-500/30 bg-red-950/20"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {isOnline ? (
            <Wifi className="h-5 w-5 text-emerald-400" />
          ) : (
            <WifiOff className="h-5 w-5 text-red-400" />
          )}
          <div>
            <h3 className="font-semibold text-white">{name}</h3>
            <p className="text-sm text-zinc-400">
              {number ? `+${number.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "$1 $2 $3-$4")}` : "Sem numero"}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            isOnline
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-red-500/20 text-red-400"
          }`}
        >
          {isOnline ? "Online" : status || "Offline"}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-zinc-400">
        <div className="flex items-center gap-1.5">
          <Shield
            className={`h-3.5 w-3.5 ${proxy ? "text-emerald-400" : "text-zinc-600"}`}
          />
          Proxy {proxy ? "ON" : "OFF"}
        </div>
        <div className="flex items-center gap-1.5">
          <MessageSquare
            className={`h-3.5 w-3.5 ${chatwoot ? "text-emerald-400" : "text-zinc-600"}`}
          />
          Chatwoot {chatwoot ? "ON" : "OFF"}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onRestart(name)}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Reiniciar
        </button>
        <button
          onClick={() => onDelete(name)}
          className="flex items-center gap-1.5 rounded-lg bg-red-900/30 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-900/50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remover
        </button>
      </div>
    </div>
  );
}
