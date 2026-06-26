import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { Permission, EnterpriseRole } from "./enterpriseAuth";
import { canAccessRoute as checkRoute } from "./enterpriseAuth";
import { fetchWithTimeout } from "../api/safeFetch";
import { bootstrapSsoFromUrl } from "../lib/ssoConsumer";

type EmployeeInfo = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  location?: string | null;
  status: string;
};

export type UserInfo = {
  id: string;
  email: string;
  role: string;
  name?: string;
  enterpriseRole: EnterpriseRole;
  enterpriseRoleLabel: string;
  permissions: Permission[];
  modules: string[];
  defaultRoute: string;
  employee: EmployeeInfo | null;
  welcomeGreeting?: string;
};

type AuthContextType = {
  user: UserInfo | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
  applySessionUser: (user: UserInfo | null) => void;
  logout: () => Promise<void>;
  hasPermission: (permission: Permission) => boolean;
  canAccessRoute: (path: string) => boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  refreshUser: async () => {},
  applySessionUser: () => {},
  logout: async () => {},
  hasPermission: () => false,
  canAccessRoute: () => false,
});

const SESSION_TIMEOUT_MS = 8000;

function isSuperAdmin(user: UserInfo | null): boolean {
  if (!user) return false;
  return user.role === "owner" || user.enterpriseRole === "founder" || user.email === "service@ifcdc.org";
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const authEpochRef = useRef(0);

  const applySessionUser = useCallback((next: UserInfo | null) => {
    authEpochRef.current += 1;
    setUser(next);
    setLoading(false);
  }, []);

  const refreshUser = useCallback(async () => {
    const epoch = authEpochRef.current;
    try {
      let res = await fetchWithTimeout("/api/hq/auth/session", { credentials: "include" }, SESSION_TIMEOUT_MS);
      if (epoch !== authEpochRef.current) return;

      if (res.ok) {
        const data = await res.json();
        setUser(data.user ?? null);
        return;
      }

      if (epoch === authEpochRef.current) {
        res = await fetch("/api/hq/auth/session", { credentials: "include" });
        if (epoch !== authEpochRef.current) return;
        if (res.ok) {
          const data = await res.json();
          setUser(data.user ?? null);
          return;
        }
      }

      setUser(null);
    } catch {
      if (epoch !== authEpochRef.current) return;
      setUser(null);
    } finally {
      if (epoch === authEpochRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const logout = useCallback(async () => {
    authEpochRef.current += 1;
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // ignore
    }
    setUser(null);
    setLoading(false);
  }, []);

  const hasPermission = useCallback(
    (permission: Permission) => {
      if (!user) return false;
      if (isSuperAdmin(user)) return true;
      return user.permissions.includes(permission);
    },
    [user]
  );

  const canAccessRoute = useCallback(
    (path: string) => {
      if (!user) return false;
      if (isSuperAdmin(user)) return true;
      return checkRoute(user.permissions, path);
    },
    [user]
  );

  useEffect(() => {
    bootstrapSsoFromUrl()
      .catch(() => false)
      .finally(() => refreshUser());
    const safety = setTimeout(() => setLoading(false), SESSION_TIMEOUT_MS + 500);
    return () => clearTimeout(safety);
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ user, loading, refreshUser, applySessionUser, logout, hasPermission, canAccessRoute }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
