"use client";

import { useToast } from "@/hooks/useToast";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ToastNotification() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => {
        let Icon = Info;
        let borderClass = "border-sky-500/30 bg-slate-900/90 text-sky-200";
        let iconColor = "text-sky-400";

        if (t.type === "success") {
          Icon = CheckCircle2;
          borderClass = "border-emerald-500/30 bg-slate-900/90 text-emerald-200";
          iconColor = "text-emerald-400";
        } else if (t.type === "error") {
          Icon = AlertCircle;
          borderClass = "border-rose-500/40 bg-slate-900/95 text-rose-200";
          iconColor = "text-rose-400";
        } else if (t.type === "warning") {
          Icon = AlertTriangle;
          borderClass = "border-amber-500/30 bg-slate-900/90 text-amber-200";
          iconColor = "text-amber-400";
        }

        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-2",
              borderClass
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Icon className={cn("w-5 h-5 shrink-0", iconColor)} />
              <span className="text-sm font-medium leading-tight truncate">{t.message}</span>
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
