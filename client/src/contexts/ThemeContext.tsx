import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { safeLocalStorage } from "@/lib/storage";
type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";
type ThemeContextType = {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
  toggleTheme?: () => void;
  switchable: boolean;
};
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}) {
  const [preference, updatePreference] = useState<ThemePreference>(() => {
    if (!switchable) return defaultTheme;
    const saved =
      safeLocalStorage.getItem("theme-preference") ??
      safeLocalStorage.getItem("theme");
    return saved === "light" || saved === "dark" || saved === "system"
      ? saved
      : "system";
  });
  const [system, setSystem] = useState<Theme>(() =>
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)"),
      change = () => setSystem(media.matches ? "dark" : "light");
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const theme = preference === "system" ? system : preference;
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);
  const setPreference = (value: ThemePreference) => {
    if (!switchable) return;
    safeLocalStorage.setItem("theme-preference", value);
    if (value === "system") safeLocalStorage.removeItem("theme");
    else safeLocalStorage.setItem("theme", value);
    updatePreference(value);
  };
  return (
    <ThemeContext.Provider
      value={{
        theme,
        preference,
        setPreference,
        switchable,
        toggleTheme: switchable
          ? () => setPreference(theme === "dark" ? "light" : "dark")
          : undefined,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw Error("useTheme must be used within ThemeProvider");
  return value;
}
