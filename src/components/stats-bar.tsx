"use client";

import { Wifi, WifiOff, Smartphone, Server, MessageSquare, Shield, Loader2 } from "lucide-react";

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
    <div className="space-y-4">
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

      <div className="flex items-center gap-3 flex-wrap">
        {healthLoading ? (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
            <span className="text-xs text-zinc-500">Verificando servicos...</span>
          </div>
        ) : health ? (
          health.services.map((svc) => {
            const Icon = serviceIcons[svc.service] || Server;
            const label = serviceLabels[svc.service] || svc.service;
            return (
              <div
                key={svc.service}
                title={svc.detail || ""}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                  svc.ok
                    ? "border-emerald-500/20 bg-emerald-950/20"
                    : "border-red-500/20 bg-red-950/20"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${svc.ok ? "text-emerald-400" : "text-red-400"}`} />
                <span className={`text-xs font-medium ${svc.ok ? "text-emerald-300" : "text-red-300"}`}>
                  {label}
                </span>
                <span className={`text-xs ${svc.ok ? "text-emerald-500" : "text-red-500"}`}>
                  {svc.ok ? `${svc.latencyMs}ms` : "Erro"}
                </span>
                {svc.service === "proxy" && svc.ok && svc.ip && (
                  <span className="text-xs text-zinc-500">{svc.ip}</span>
                )}
              </div>
            );
          })
        ) : null}
      </div>
    </div>
  );
}
