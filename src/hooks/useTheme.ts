import { useEffect } from "react";
import { useMediaQuery } from "./useMediaQuery";

export type ThemeSetting = "system" | "light" | "dark";

export function useApplyTheme(theme: ThemeSetting): "light" | "dark" {
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolved: "light" | "dark" = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
  }, [resolved]);
  return resolved;
}
