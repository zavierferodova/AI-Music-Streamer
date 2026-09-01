"use client";

import { useState, useEffect, useCallback } from "react";
import { checkAuthStatus, getAuthRole, verifyOtp } from "@/lib/api";
import { UserRole } from "@/types";

export function useAuth() {
  const [isSecurityEnabled, setIsSecurityEnabled] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [role, setRole] = useState<UserRole | null>(() => getAuthRole());
  const [isLockModalOpen, setIsLockModalOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      const data = await checkAuthStatus();
      if (data) {
        setIsSecurityEnabled(data.security_enabled);
        setIsAuthenticated(data.authenticated);
        if (data.role) {
          setRole(data.role);
        } else if (!data.authenticated) {
          setRole(null);
        }

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
        if (res.role) {
          setRole(res.role);
        }
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

  // Derived role flags
  const isAdmin = !isSecurityEnabled || (isAuthenticated && role === "admin");
  const isSubscriber = isSecurityEnabled && isAuthenticated && role === "subscriber";

  return {
    isSecurityEnabled,
    isAuthenticated,
    role,
    isAdmin,
    isSubscriber,
    isLockModalOpen,
    setIsLockModalOpen,
    authLoading,
    authError,
    setAuthError,
    submitCode,
    refreshAuth,
  };
}
