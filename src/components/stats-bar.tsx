"use client";

import { Wifi, WifiOff, Smartphone } from "lucide-react";

interface StatsBarProps {
  total: number;
  online: number;
  offline: number;
}

export function StatsBar({ total, online, offline }: StatsBarProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-zinc-800 p-2">
            <Smartphone className="h-5 w-5 text-zinc-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{total}</p>
            <p className="text-xs text-zinc-500">Total de Chips</p>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-emerald-900/30 p-2">
            <Wifi className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-400">{online}</p>
            <p className="text-xs text-zinc-500">Online</p>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-red-500/20 bg-red-950/20 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-red-900/30 p-2">
            <WifiOff className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-red-400">{offline}</p>
            <p className="text-xs text-zinc-500">Offline</p>
          </div>
        </div>
      </div>
    </div>
  );
}
