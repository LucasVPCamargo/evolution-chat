"use client";

import { useState } from "react";
import {
  Wifi,
  WifiOff,
  Shield,
  MessageSquare,
  Trash2,
  RotateCw,
  Link,
  Globe,
  Loader2,
  AlertTriangle,
} from "lucide-react";

export interface ProxyDetails {
  enabled?: boolean;
  host?: string;
  port?: string;
  protocol?: string;
  username?: string;
  password?: string;
}

interface ProxyIpResult {
  ip: string;
  country: string;
  city: string;
  latencyMs: number;
}

interface ChipCardProps {
  name: string;
  number: string;
  status: string;
  proxy: boolean;
  proxyDetails: ProxyDetails | null;
  chatwoot: boolean;
  zombie?: boolean;
  onRestart: (name: string) => void;
  onDelete: (name: string) => void;
  onReconnect: (name: string) => void;
}

export function ChipCard({
  name,
  number,
  status,
  proxy,
  proxyDetails,
  chatwoot,
  zombie = false,
  onRestart,
  onDelete,
  onReconnect,
}: ChipCardProps) {
  // Zombie e tratado como close pra UX: chip esta efetivamente fora
  // (sessao Baileys morta, inbox removido). Quarentena pode ainda nao ter
  // conseguido flippar o status no Evolution (deep zombie), mas pro user
  // o chip e inutil e precisa Reconectar.
  const isOnline = status === "open" && !zombie;
  const isConnecting = status === "connecting";
  const isClosed = status === "close" || zombie;
  const [proxyIp, setProxyIp] = useState<ProxyIpResult | null>(null);
  const [checkingIp, setCheckingIp] = useState(false);
  const [ipError, setIpError] = useState(false);

  async function handleCheckIp() {
    setCheckingIp(true);
    setIpError(false);
    try {
      const res = await fetch("/api/chips/proxy-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) { setIpError(true); return; }
      const data = await res.json();
      setProxyIp(data);
    } catch {
      setIpError(true);
    } finally {
      setCheckingIp(false);
    }
  }

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
          {isOnline ? "Online" : isConnecting ? "Conectando..." : zombie ? "Fechado" : status || "Offline"}
        </span>
      </div>

      {zombie && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
          <div className="flex-1">
            <p className="font-medium text-red-400">Sessao Baileys morta — chip quarentenado</p>
            <p className="mt-0.5 text-red-400/70">
              Inbox removido do Chatwoot pra agentes nao usarem. Clica em <span className="font-semibold">Reconectar</span> pra parear de novo.
            </p>
          </div>
        </div>
      )}

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

      {/* Proxy Details */}
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
          <div className="mt-1.5 flex items-center gap-2">
            {proxyIp ? (
              <span className={`font-mono ${proxyIp.country === "BR" ? "text-emerald-400" : "text-amber-400"}`}>
                {proxyIp.ip} - {proxyIp.city}, {proxyIp.country}
                <span className="ml-1 text-zinc-600">({proxyIp.latencyMs}ms)</span>
              </span>
            ) : ipError ? (
              <span className="text-red-400">Proxy sem resposta</span>
            ) : null}
            <button
              onClick={handleCheckIp}
              disabled={checkingIp}
              className="ml-auto flex items-center gap-1 rounded bg-zinc-700/60 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
            >
              {checkingIp ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Globe className="h-3 w-3" />
                  Checar IP
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {(isClosed || zombie) && (
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
