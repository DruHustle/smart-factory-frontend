import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState, useEffect } from "react";
import {
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  getCurrentUser,
} from "@/lib/api-auth";
import type { User } from "../../../drizzle/schema";
import { SESSION_EXPIRED_EVENT } from "@/lib/session-expiry";
type PublicUser = Omit<User, "password" | "authVersion">;

interface AuthContextType {
  user: PublicUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (
    email: string,
    password: string,
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  register: (
    email: string,
    password: string,
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const result = await getCurrentUser();
        if (result.success && result.user) {
          setUser(result.user);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Auth initialization failed:", error);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  useEffect(() => {
    const expireSession = () => {
      queryClient.clear();
      setUser(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expireSession);
    return () =>
      window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession);
  }, [queryClient]);

  const login = async (email: string, password: string) => {
    try {
      const result = await apiLogin(email, password);

      if (result.success) {
        queryClient.clear();
        setUser(result.user || null);
        return { success: true };
      }

      return { success: false, error: result.error || "Login failed" };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "An unexpected error occurred",
      };
    }
  };

  const register = async (email: string, password: string, name: string) => {
    try {
      const result = await apiRegister(email, password, name);

      if (result.success) {
        queryClient.clear();
        setUser(result.user || null);
        return { success: true };
      }
      return { success: false, error: result.error || "Registration failed" };
    } catch (error: any) {
      return { success: false, error: error.message || "Registration failed" };
    }
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch (error) {
      console.error("Logout request failed:", error);
    } finally {
      queryClient.clear();
      // Always clear local state
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        register,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
