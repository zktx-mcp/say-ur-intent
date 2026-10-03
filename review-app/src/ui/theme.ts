// Shared theme helper for every page. It reads and writes ONLY the theme value,
// under one fixed storage key, with the stored value restricted to "light" or
// "dark". It never reads or writes a token, session id, wallet account, or any
// other state. The theme is applied as a `data-theme` attribute on the document
// root; all colors come from CSS variables in the shared stylesheet, so no inline
// styles are needed and the strictest page CSP is satisfied.

export type Theme = "light" | "dark";

const STORAGE_KEY = "sui-mcp-theme";

export function readStoredTheme(): Theme | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode, disabled); the theme still
    // applies for this page load even when it cannot be persisted.
  }
}

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

// Resolve the starting theme: a stored choice wins, otherwise the OS preference,
// otherwise light. Apply it to the document root and return it.
export function initTheme(): Theme {
  const theme = readStoredTheme() ?? (prefersDark() ? "dark" : "light");
  applyTheme(theme);
  return theme;
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  storeTheme(theme);
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
