"use client";

import { Lock, Shield, Headphones, Users, Activity, Crown } from "lucide-react";
import { ConnectionState } from "@/lib/ws";
import { UserRole } from "@/types";

interface HeaderProps {
  isSecurityEnabled: boolean;
  isAuthenticated: boolean;
  role?: UserRole | null;
  onOpenLockModal: () => void;
  connectionState: ConnectionState;
  listenerCount: number;
}

export function Header({
  isSecurityEnabled,
  isAuthenticated,
  role,
  onOpenLockModal,
  connectionState,
  listenerCount,
}: HeaderProps) {
  const isLive = connectionState === "connected";

  return (
    <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
      <div className="flex items-center gap-3.5">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 text-white shrink-0 border border-sky-400/30">
          <Activity className="w-6 h-6 animate-pulse" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            Music Streamer
          </h1>
          <p className="text-xs text-slate-400 font-medium">Live Broadcast &amp; Synced Audio</p>
        </div>
      </div>

      <div className="flex items-center flex-wrap gap-2.5">
        {/* Security & Role Badge */}
        <button
          onClick={onOpenLockModal}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all hover:scale-105 ${
            !isSecurityEnabled
              ? "bg-slate-900/80 border-slate-700/60 text-slate-300 hover:bg-slate-800/80"
              : isAuthenticated && role === "admin"
              ? "bg-gradient-to-r from-amber-500/15 to-emerald-500/15 border-amber-500/40 text-amber-300 hover:border-amber-400 shadow-sm shadow-amber-500/10"
              : isAuthenticated && role === "subscriber"
              ? "bg-sky-500/15 border-sky-500/40 text-sky-300 hover:border-sky-400"
              : "bg-slate-900/80 border-slate-700/60 text-slate-300 hover:bg-slate-800/80"
          }`}
          title="Click to manage or switch OTP security credentials"
        >
          {!isSecurityEnabled ? (
            <>
              <Shield className="w-3.5 h-3.5 text-slate-400" />
              <span>Public Access</span>
            </>
          ) : isAuthenticated && role === "admin" ? (
            <>
              <Crown className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span className="font-semibold text-amber-300">Admin (Full Control)</span>
            </>
          ) : isAuthenticated && role === "subscriber" ? (
            <>
              <Headphones className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-semibold text-sky-300">Subscriber (Stream &amp; Tracks)</span>
            </>
          ) : (
            <>
              <Lock className="w-3.5 h-3.5 text-sky-400" />
              <span>OTP Protected</span>
            </>
          )}
        </button>

        {/* Live Indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-700/60 text-xs font-medium">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isLive
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"
                : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
            }`}
          />
          <span className={isLive ? "text-emerald-400 font-semibold" : "text-amber-400"}>
            {isLive ? "LIVE (REALTIME WS)" : "CONNECTING..."}
          </span>
        </div>

        {/* Listeners Badge */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-700/60 text-xs font-medium text-slate-300">
          <Users className="w-3.5 h-3.5 text-indigo-400" />
          <span>
            <strong className="text-white font-semibold">{listenerCount}</strong> Listeners
          </span>
        </div>
      </div>
    </header>
  );
}
