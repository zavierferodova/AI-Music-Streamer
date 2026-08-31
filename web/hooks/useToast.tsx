"use client";

import React, { useState, useCallback, createContext, useContext } from "react";
import { ToastMessage, ToastType } from "@/types";

interface ToastContextType {
  toasts: ToastMessage[];
  showToast: (message: string, type?: ToastType, icon?: string) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info", icon?: string) => {
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: ToastMessage = { id, message, type, icon };
      setToasts((prev) => [...prev, newToast]);

      const timeout = type === "error" ? 4500 : 2800;
      setTimeout(() => {
        dismissToast(id);
      }, timeout);
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
