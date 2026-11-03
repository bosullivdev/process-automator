import { useEffect } from "react";
import { useMediaQuery } from "./useMediaQuery";
import { useStore } from "../store/workspace";

export type ThemeSetting = "system" | "light" | "dark";

export function useResolvedTheme(): "light" | "dark" {
  const theme = useStore((s) => s.view.theme);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function useApplyTheme(): "light" | "dark" {
  const resolved = useResolvedTheme();
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);
  return resolved;
}
