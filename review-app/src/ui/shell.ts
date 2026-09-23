// Shared shell for the session-token pages: brand, theme, content and busy state.
import { element, iconButton } from "./ui.js";
import { currentTheme, initTheme, toggleTheme, type Theme } from "./theme.js";
import { t } from "../i18n/i18n.js";

export type Shell = {
  root: HTMLElement;
  main: HTMLElement;
  setBusy(busy: boolean, label?: string): void;
};

const SUN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
// The toggle shows the icon for the theme that is CURRENTLY active - a moon while
// dark, a sun while light - not the theme it would switch to. Pure + exported so
// the convention has a behavioral test without a DOM.
export function themeToggleIcon(theme: Theme): string {
  return theme === "dark" ? MOON_ICON : SUN_ICON;
}

function brandImg(className: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = className;
  img.src = `/review-assets/${className === "ui-brand-light" ? "brand-light" : "brand-dark"}.svg`;
  img.alt = "";
  img.width = 24;
  img.height = 24;
  return img;
}

function brandNode(): HTMLElement {
  const node = element("span", "ui-brand");
  node.append(brandImg("ui-brand-light"), brandImg("ui-brand-dark"), element("span", undefined, t.brand));
  return node;
}

export function renderShell(mount: HTMLElement): Shell {
  initTheme();

  const root = element("div", "ui-shell");
  const header = element("header", "ui-header");

  header.append(brandNode());

  header.append(element("span", "ui-header-spacer"));

  const themeButton = iconButton(themeToggleIcon(currentTheme()), t.shell.toggleTheme, () => {
    const next = toggleTheme();
    themeButton.innerHTML = themeToggleIcon(next);
  });
  // The theme toggle comes before the mobile menu button; the menu button is the
  // last item and shows only at mobile width.
  header.append(themeButton);

  const main = element("main", "ui-main");

  const overlay = element("div", "ui-overlay");
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  const box = element("div", "ui-overlay-box");
  box.append(element("div", "ui-spinner"));
  const overlayLabel = element("span", "ui-overlay-label", "Processing…");
  box.append(overlayLabel);
  overlay.append(box);

  root.append(header);
  root.append(main, overlay);
  mount.replaceChildren(root);

  return {
    root,
    main,
    setBusy(busy: boolean, label?: string): void {
      if (label) {
        overlayLabel.textContent = label;
      }
      if (busy) {
        root.setAttribute("aria-busy", "true");
      } else {
        root.removeAttribute("aria-busy");
      }
    }
  };
}
