"use client";

import { useState, useEffect, useCallback } from "react";
import { checkAuthStatus, verifyOtp } from "@/lib/api";

export function useAuth() {
  const [isSecurityEnabled, setIsSecurityEnabled] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLockModalOpen, setIsLockModalOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      const data = await checkAuthStatus();
      if (data) {
        setIsSecurityEnabled(data.security_enabled);
        setIsAuthenticated(data.authenticated);
        if (data.security_enabled && !data.authenticated) {
          // Check if OTP in URL
          const params = new URLSearchParams(window.location.search);
          const otp = params.get("otp");
          if (otp && otp.length === 6) {
            submitCode(otp);
          } else {
            setIsLockModalOpen(true);
          }
        } else {
          setIsLockModalOpen(false);
        }
      }
    } catch (err) {
      console.error("refreshAuth error:", err);
    }
  }, []);

  const submitCode = useCallback(async (otp: string): Promise<boolean> => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await verifyOtp(otp);
      if (res.authenticated) {
        setIsAuthenticated(true);
        setIsLockModalOpen(false);
        setAuthLoading(false);
        return true;
      } else {
        setAuthError(res.message || "Invalid OTP Passcode");
        setAuthLoading(false);
        return false;
      }
    } catch (err: any) {
      setAuthError(err?.message || "Network error");
      setAuthLoading(false);
      return false;
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  return {
    isSecurityEnabled,
    isAuthenticated,
    isLockModalOpen,
    setIsLockModalOpen,
    authLoading,
    authError,
    setAuthError,
    submitCode,
    refreshAuth,
  };
}
