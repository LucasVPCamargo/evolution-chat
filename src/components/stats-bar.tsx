"use client";

import { Wifi, WifiOff, Smartphone, Server, MessageSquare, Shield, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface ServiceHealth {
  service: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
  ip?: string;
  country?: string;
  city?: string;
}

interface HealthResponse {
  healthy: boolean;
  timestamp: string;
  services: ServiceHealth[];
}

interface StatsBarProps {
  total: number;
  online: number;
  offline: number;
  health: HealthResponse | null;
  healthLoading: boolean;
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

export function StatsBar({ total, online, offline, health, healthLoading }: StatsBarProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-zinc-800 p-2.5">
              <Smartphone className="h-5 w-5 text-zinc-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{total}</p>
              <p className="text-xs text-zinc-500">Total de Chips</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-500/10 bg-zinc-900/80 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2.5">
              <Wifi className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-400">{online}</p>
              <p className="text-xs text-zinc-500">Online</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-red-500/10 bg-zinc-900/80 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/10 p-2.5">
              <WifiOff className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-red-400">{offline}</p>
              <p className="text-xs text-zinc-500">Offline</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium">Status:</span>
        {healthLoading ? (
          <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1">
            <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
            <span className="text-[11px] text-zinc-500">Verificando...</span>
          </div>
        ) : health ? (
          health.services.map((svc) => {
            const Icon = serviceIcons[svc.service] || Server;
            const label = serviceLabels[svc.service] || svc.service;
            return (
              <div
                key={svc.service}
                title={svc.detail || ""}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${
                  svc.ok
                    ? "border-emerald-500/15 bg-zinc-900/80"
                    : "border-red-500/20 bg-red-950/30"
                }`}
              >
                <div className={`h-1.5 w-1.5 rounded-full ${svc.ok ? "bg-emerald-400" : "bg-red-400 animate-pulse"}`} />
                <Icon className={`h-3 w-3 ${svc.ok ? "text-zinc-400" : "text-red-400"}`} />
                <span className={`text-[11px] ${svc.ok ? "text-zinc-300" : "text-red-300"}`}>
                  {label}
                </span>
                <span className="text-[10px] text-zinc-600">
                  {svc.ok ? `${svc.latencyMs}ms` : ""}
                </span>
              </div>
            );
          })
        ) : null}
      </div>
    </div>
  );
}
