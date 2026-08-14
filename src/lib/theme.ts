import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = Exclude<ThemePreference, "system">;

const STORAGE_KEY = "openmausbot-theme";
const THEME_CHANGE_EVENT = "openmausbot:theme-change";
const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function getThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return window.matchMedia(DARK_MODE_QUERY).matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute("content", resolved === "dark" ? "#070707" : "#f4f4f5");
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // The active choice still applies when storage is unavailable.
  }
  applyTheme(preference);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: preference }));
}

export function initializeTheme(): () => void {
  applyTheme(getThemePreference());
  const media = window.matchMedia(DARK_MODE_QUERY);
  const handleSystemChange = () => {
    if (getThemePreference() === "system") applyTheme("system");
  };
  media.addEventListener("change", handleSystemChange);
  return () => media.removeEventListener("change", handleSystemChange);
}

export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(getThemePreference);

  useEffect(() => {
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail;
      if (isThemePreference(next)) setPreference(next);
    };
    window.addEventListener(THEME_CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleChange);
  }, []);

  return [preference, setThemePreference];
}
