"use client";

import { useToast } from "@/hooks/useToast";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ToastNotification() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-6 sm:bottom-6 z-50 flex flex-col gap-2 sm:max-w-md w-auto sm:w-full pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((t) => {
        let Icon = Info;
        let borderClass = "border-sky-500/30 bg-slate-900/95 text-sky-200 shadow-sky-500/10";
        let iconColor = "text-sky-400";

        if (t.type === "success") {
          Icon = CheckCircle2;
          borderClass = "border-emerald-500/30 bg-slate-900/95 text-emerald-200 shadow-emerald-500/10";
          iconColor = "text-emerald-400";
        } else if (t.type === "error") {
          Icon = AlertCircle;
          borderClass = "border-rose-500/40 bg-slate-900/95 text-rose-200 shadow-rose-500/15";
          iconColor = "text-rose-400";
        } else if (t.type === "warning") {
          Icon = AlertTriangle;
          borderClass = "border-amber-500/30 bg-slate-900/95 text-amber-200 shadow-amber-500/10";
          iconColor = "text-amber-400";
        }

        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-center justify-between gap-3 px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-2xl border shadow-2xl backdrop-blur-xl transition-all duration-200 animate-in fade-in slide-in-from-bottom-3",
              borderClass
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <Icon className={cn("w-4 h-4 sm:w-5 sm:h-5 shrink-0", iconColor)} />
              <span className="text-xs sm:text-sm font-medium leading-snug break-words">
                {t.message}
              </span>
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-slate-400 hover:text-white transition-colors p-1 sm:p-1.5 rounded-xl hover:bg-white/10 shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
