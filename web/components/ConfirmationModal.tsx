"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Trash2, Volume2, X } from "lucide-react";

export type ConfirmationVariant =
  | "danger"
  | "destructive"
  | "warning"
  | "success"
  | "primary"
  | "info"
  | "speaker";

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  variant?: ConfirmationVariant;
  icon?: React.ReactNode;
  confirmIcon?: React.ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  isDestructive,
  variant,
  icon,
  confirmIcon,
  onConfirm,
  onClose,
}: ConfirmationModalProps) {
  const [mounted, setMounted] = useState(false);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  // Determine effective variant
  const resolvedVariant: ConfirmationVariant =
    variant || (isDestructive !== undefined ? (isDestructive ? "danger" : "warning") : "danger");

  // Determine labels and styling based on variant
  let badgeStyle = "bg-rose-500/20 text-rose-300 border-rose-500/30";
  let buttonStyle = "bg-rose-600 hover:bg-rose-500 shadow-rose-500/20 text-white";
  let defaultHeaderIcon = <Trash2 className="w-4 h-4" />;
  let defaultConfirmIcon = <Trash2 className="w-3.5 h-3.5" />;
  let defaultConfirmLabel = "Delete";

  if (resolvedVariant === "speaker" || resolvedVariant === "success") {
    badgeStyle = "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    buttonStyle =
      "bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-emerald-500/25 text-white";
    defaultHeaderIcon = <Volume2 className="w-4 h-4 text-emerald-400" />;
    defaultConfirmIcon = <Volume2 className="w-3.5 h-3.5" />;
    defaultConfirmLabel = "Confirm";
  } else if (resolvedVariant === "warning") {
    badgeStyle = "bg-amber-500/20 text-amber-300 border-amber-500/30";
    buttonStyle = "bg-amber-600 hover:bg-amber-500 shadow-amber-500/20 text-white";
    defaultHeaderIcon = <AlertTriangle className="w-4 h-4 text-amber-400" />;
    defaultConfirmIcon = <AlertTriangle className="w-3.5 h-3.5" />;
    defaultConfirmLabel = "Confirm";
  } else if (resolvedVariant === "primary" || resolvedVariant === "info") {
    badgeStyle = "bg-indigo-500/20 text-indigo-300 border-indigo-500/30";
    buttonStyle =
      "bg-gradient-to-r from-indigo-500 to-sky-500 hover:from-indigo-400 hover:to-sky-400 shadow-indigo-500/20 text-white";
    defaultHeaderIcon = <Check className="w-4 h-4 text-indigo-400" />;
    defaultConfirmIcon = <Check className="w-3.5 h-3.5" />;
    defaultConfirmLabel = "Confirm";
  }

  const finalConfirmLabel = confirmLabel || defaultConfirmLabel;

  const modalContent = (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md flex flex-col rounded-3xl bg-slate-900 border border-slate-700/70 shadow-2xl overflow-hidden animate-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl border ${badgeStyle}`}>
              {icon || defaultHeaderIcon}
            </div>
            <h3 className="text-sm font-bold text-white">{title}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            {typeof message === "string" ? <p>{message}</p> : message}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-all"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmBtnRef}
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold shadow-md transition-all hover:scale-105 active:scale-95 ${buttonStyle}`}
            >
              {confirmIcon || defaultConfirmIcon}
              <span>{finalConfirmLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
