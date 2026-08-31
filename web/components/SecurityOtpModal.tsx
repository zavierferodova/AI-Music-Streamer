"use client";

import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent } from "react";
import { Lock, KeyRound, Loader2, AlertCircle, X } from "lucide-react";
import { useToast } from "@/hooks/useToast";

interface SecurityOtpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitOtp: (otp: string) => Promise<boolean>;
  error?: string | null;
  loading?: boolean;
}

export function SecurityOtpModal({
  isOpen,
  onClose,
  onSubmitOtp,
  error,
  loading,
}: SecurityOtpModalProps) {
  const { showToast } = useToast();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [isShaking, setIsShaking] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (isOpen) {
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => {
        inputsRef.current[0]?.focus();
      }, 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (error) {
      setIsShaking(true);
      const timer = setTimeout(() => setIsShaking(false), 400);
      return () => clearTimeout(timer);
    }
  }, [error]);

  if (!isOpen) return null;

  const handleDigitChange = (index: number, val: string) => {
    const char = val.slice(-1);
    if (char && !/^\d$/.test(char)) return;

    const newDigits = [...digits];
    newDigits[index] = char;
    setDigits(newDigits);

    if (char && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }

    if (char && index === 5) {
      const fullCode = newDigits.join("");
      if (fullCode.length === 6) {
        handleSubmit(fullCode);
      }
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (!digits[index] && index > 0) {
        inputsRef.current[index - 1]?.focus();
      }
    } else if (e.key === "Enter") {
      const fullCode = digits.join("");
      if (fullCode.length === 6) {
        handleSubmit(fullCode);
      }
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").trim();
    if (/^\d+$/.test(text)) {
      const chars = text.slice(0, 6).split("");
      const newDigits = [...digits];
      chars.forEach((c, i) => {
        newDigits[i] = c;
      });
      setDigits(newDigits);
      if (chars.length === 6) {
        handleSubmit(chars.join(""));
      } else {
        inputsRef.current[chars.length]?.focus();
      }
    }
  };

  const handleSubmit = async (codeOverride?: string) => {
    const code = codeOverride || digits.join("");
    if (code.length < 6) return;
    const ok = await onSubmitOtp(code);
    if (ok) {
      showToast("Unlocked successfully! Welcome.", "success", "lock_open");
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-lg animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full max-w-sm flex flex-col items-center rounded-3xl bg-slate-900 border border-slate-700/70 p-6 shadow-2xl transition-all ${
          isShaking ? "animate-shake" : "animate-in zoom-in-95"
        }`}
      >
        <div className="w-full flex justify-end">
          <button
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Lock Icon */}
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/25 mb-4 border border-sky-400/30">
          <Lock className="w-7 h-7" />
        </div>

        <h2 className="text-lg font-bold text-white tracking-tight text-center">
          Passcode Required
        </h2>
        <p className="text-xs text-slate-400 text-center mt-1 mb-6 leading-relaxed">
          Enter the 6-digit One-Time Password (OTP) displayed in your server console or run{" "}
          <code className="text-sky-300 font-mono px-1 py-0.5 rounded bg-slate-800">./otp.py</code>
        </p>

        {/* OTP Digits */}
        <div className="flex items-center justify-center gap-2 mb-4 w-full">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputsRef.current[i] = el;
              }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={handlePaste}
              className="w-10 h-12 text-center text-lg font-mono font-bold rounded-xl bg-slate-800 border border-slate-700 text-white outline-none focus:border-sky-500 focus:shadow-[0_0_12px_rgba(56,189,248,0.4)] transition-all"
            />
          ))}
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-1.5 text-rose-400 text-xs font-medium mb-4">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Unlock Button */}
        <button
          onClick={() => handleSubmit()}
          disabled={loading || digits.join("").length < 6}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-sky-500/20 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <KeyRound className="w-4 h-4" />
          )}
          <span>{loading ? "Verifying..." : "Unlock Control Panel"}</span>
        </button>
      </div>
    </div>
  );
}
