// Shared atomic UI components, built as vanilla TypeScript DOM helpers paired
// with the shared stylesheet. Every page composes these instead of defining its
// own component CSS. The stylesheet itself ships as a stable static asset
// (`review-app/public/ui.css`, served at `/review-assets/ui.css`) and is linked
// from each page's <head>, so it is not bundled per entry and is never
// code-split into an unlinked chunk.

import { shortAddress, shortHex } from "../format.js";

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export type ButtonVariant = "primary" | "secondary" | "danger";

export function button(label: string, onClick: () => void, variant: ButtonVariant = "primary"): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className =
    variant === "primary" ? "ui-btn ui-btn--primary" : variant === "danger" ? "ui-btn ui-btn--danger" : "ui-btn";
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

// Inline-SVG icon button. `svgMarkup` is a trusted constant from our own code,
// never user data, so assigning it as innerHTML carries no injection surface.
export function iconButton(svgMarkup: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "ui-icon-btn";
  node.setAttribute("aria-label", ariaLabel);
  node.innerHTML = svgMarkup;
  node.addEventListener("click", onClick);
  return node;
}

// A horizontal group of buttons that share one width: each direct .ui-btn child
// is sized equally and the group wraps to full-width stacked rows when too narrow,
// so a short and a long label still read as a matched pair.
export function buttonRow(...buttons: HTMLElement[]): HTMLElement {
  const node = element("div", "ui-btn-row");
  node.append(...buttons);
  return node;
}

// A single standalone button placed in a right-aligned action row, so a solo control reads
// as the section's action (and gains the row's top spacing) instead of a bare left-aligned
// button flush against the text above it.
export function endRow(btn: HTMLElement): HTMLElement {
  const node = buttonRow(btn);
  node.classList.add("ui-btn-row--end");
  return node;
}

export function link(text: string, href: string): HTMLAnchorElement {
  const node = document.createElement("a");
  node.className = "ui-link";
  node.textContent = text;
  node.href = href;
  return node;
}

export function input(options: {
  type?: string;
  value?: string;
  placeholder?: string;
  id?: string;
  name?: string;
}): HTMLInputElement {
  const node = document.createElement("input");
  node.className = "ui-input";
  node.type = options.type ?? "text";
  if (options.value !== undefined) {
    node.value = options.value;
  }
  if (options.placeholder !== undefined) {
    node.placeholder = options.placeholder;
  }
  if (options.id) {
    node.id = options.id;
  }
  if (options.name) {
    node.name = options.name;
  }
  node.autocomplete = "off";
  return node;
}

export function field(labelText: string, control: HTMLElement): HTMLLabelElement {
  const node = document.createElement("label");
  node.className = "ui-field";
  node.append(element("span", undefined, labelText), control);
  return node;
}

export function select(options: {
  value?: string;
  id?: string;
  name?: string;
  choices: ReadonlyArray<{ value: string; label: string }>;
  onChange?: (value: string) => void;
}): HTMLSelectElement {
  const node = document.createElement("select");
  node.className = "ui-select";
  for (const choice of options.choices) {
    const option = document.createElement("option");
    option.value = choice.value;
    option.textContent = choice.label;
    if (options.value === choice.value) {
      option.selected = true;
    }
    node.append(option);
  }
  if (options.id) {
    node.id = options.id;
  }
  if (options.name) {
    node.name = options.name;
  }
  if (options.onChange) {
    node.addEventListener("change", () => options.onChange!(node.value));
  }
  return node;
}

export function card(title?: string): HTMLElement {
  const node = element("section", "ui-card");
  if (title) {
    node.append(element("h2", "ui-card-head", title));
  }
  return node;
}

export function row(label: string, value: string | Node): HTMLElement {
  const node = element("div", "ui-row");
  node.append(element("span", "ui-row-label", label));
  const valueNode = element("span", "ui-row-value");
  if (typeof value === "string") {
    valueNode.textContent = value;
  } else {
    valueNode.append(value);
  }
  node.append(valueNode);
  return node;
}

export function sectionTitle(text: string): HTMLElement {
  return element("div", "ui-section-title", text);
}

export function badge(text: string): HTMLElement {
  return element("span", "ui-badge", text);
}

export type PillKind = "neutral" | "ok" | "warn" | "danger";

export function pill(text: string, kind: PillKind = "neutral"): HTMLElement {
  const suffix = kind === "ok" ? " ui-pill--ok" : kind === "warn" ? " ui-pill--warn" : kind === "danger" ? " ui-pill--danger" : "";
  return element("span", `ui-pill${suffix}`, text);
}

// Selectable chip (toggle button). The label stays legible in every state and
// both themes: an unselected chip uses the normal text color, never relying on
// the selected-state color for legibility.
export function chip(
  label: string,
  options: { selected?: boolean; disabled?: boolean; size?: "sm"; onClick?: () => void } = {}
): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  const classes = ["ui-chip"];
  if (options.selected) {
    classes.push("ui-chip--selected");
  }
  if (options.size === "sm") {
    classes.push("ui-chip--sm");
  }
  node.className = classes.join(" ");
  node.textContent = label;
  node.setAttribute("aria-pressed", options.selected ? "true" : "false");
  if (options.disabled) {
    node.disabled = true;
  }
  if (options.onClick) {
    node.addEventListener("click", options.onClick);
  }
  return node;
}

// A connected/bound wallet shown compactly: optional wallet name + the shortened
// address (full address on hover). Shared by the Connect page and the review header.
export function walletChip(options: {
  address: string;
  walletName?: string;
  signerStatus?: "ready" | "settling" | "idle";
}): HTMLElement {
  const node = element("span", "ui-wallet-chip");
  if (options.signerStatus) {
    // A small leading dot reflects whether the browser signer is ready for the
    // signing step (ready = matches the bound account, settling = reconnecting,
    // idle = none). Decorative: where readiness actually matters it is also stated
    // in text (the signing section), so the dot carries no aria role here.
    const dot = element("span", "ui-wallet-chip-dot");
    if (options.signerStatus !== "ready") {
      dot.classList.add(`ui-wallet-chip-dot--${options.signerStatus}`);
    }
    dot.setAttribute("aria-hidden", "true");
    node.append(dot);
  }
  if (options.walletName) {
    node.append(element("span", "ui-wallet-chip-name", options.walletName));
  }
  node.append(mono(shortAddress(options.address)));
  // The visible value is shortened; the full address stays available to assistive
  // tech and on hover (callers that need it visible/copyable render it separately).
  node.title = options.address;
  node.setAttribute("aria-label", options.walletName ? `${options.walletName} ${options.address}` : options.address);
  return node;
}

// A badge marking a page opened from the user's AI client (the token pages). The
// label is passed in (i18n) so the atom carries no copy.
export function agentOriginBadge(label: string): HTMLElement {
  return element("span", "ui-agent-badge", label);
}

export type StatusKind = "success" | "failure" | "pending" | "neutral";

// Single source for the shared check and close glyphs. The status banner, the modal
// close button, and (CHECK_ICON, exported) the PTB graph card's copy-success state all
// reuse these, so the same path is never hand-written in two places.
export const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
export const COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

const STATUS_ICONS: Record<StatusKind, string> = {
  success: CHECK_ICON,
  failure: CLOSE_ICON,
  pending:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  neutral: ""
};

// Prominent result banner: the single, reusable way to show an outcome (a chain
// receipt's execution status now, an execution result later) with an icon and
// color, not color alone.
export function statusBanner(kind: StatusKind, label: string): HTMLElement {
  const node = element("div", `ui-status-banner ui-status-banner--${kind}`);
  node.setAttribute("role", "status");
  const icon = STATUS_ICONS[kind];
  if (icon) {
    const glyph = element("span", "ui-status-icon");
    glyph.innerHTML = icon;
    node.append(glyph);
  }
  node.append(element("span", undefined, label));
  return node;
}

// Reusable transaction-fact block: a headline title, an optional trailing value
// (monospace, e.g. a signed amount), and muted monospace meta lines that keep the
// minimal display while exposing the full value via `title`. One component for a
// receipt's balance/object/Move-call facts and, later, the execution facts.
export function detailItem(options: {
  title: string;
  trailing?: string;
  // Tints the trailing value for a signed balance/amount: "up" (gain) or "down"
  // (loss). Reusable for a receipt's balance changes and, later, execution results.
  trailingTone?: "up" | "down";
  metas?: ReadonlyArray<{ label?: string; value: string; full?: string }>;
}): HTMLElement {
  const item = element("div", "ui-detail-item");
  const head = element("div", "ui-detail-head");
  head.append(element("span", "ui-detail-title", options.title));
  if (options.trailing !== undefined) {
    const trailing = mono(options.trailing);
    trailing.classList.add("ui-detail-trailing");
    if (options.trailingTone) {
      trailing.classList.add(`ui-detail-trailing--${options.trailingTone}`);
    }
    head.append(trailing);
  }
  item.append(head);
  for (const meta of options.metas ?? []) {
    const line = element("div", "ui-detail-meta");
    if (meta.label) {
      line.append(element("span", "ui-detail-metalabel", meta.label));
    }
    const value = mono(meta.value);
    if (meta.full && meta.full !== meta.value) {
      value.title = meta.full;
    }
    line.append(value);
    item.append(line);
  }
  return item;
}

// Collapsed-by-default disclosure for a secondary fact group. Returns the
// <details>; the caller appends the group's content into `.body` (kept separate
// so its padding is consistent). Mirrors the native-<details> pattern the review
// page already uses for collapsible records.
export function accordion(summaryText: string, open = false): { details: HTMLDetailsElement; body: HTMLElement } {
  const details = document.createElement("details");
  details.className = "ui-accordion";
  details.open = open;
  const summary = document.createElement("summary");
  summary.className = "ui-accordion-summary";
  summary.append(element("span", undefined, summaryText));
  const body = element("div", "ui-accordion-body");
  details.append(summary, body);
  return { details, body };
}

// Centered modal dialog. The caller renders the returned overlay only while open,
// so closing is the caller clearing its open flag and re-rendering; click-outside
// and the close button both invoke onClose. Append page content to `body`.
export function modal(options: { title: string; onClose: () => void }): { overlay: HTMLElement; body: HTMLElement } {
  const overlay = element("div", "ui-modal");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const dialog = element("div", "ui-modal-dialog");
  const head = element("div", "ui-modal-head");
  head.append(element("h2", "ui-modal-title", options.title), iconButton(CLOSE_ICON, "Close", options.onClose));
  const body = element("div", "ui-modal-body");
  dialog.append(head, body);
  overlay.append(dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      options.onClose();
    }
  });
  return { overlay, body };
}

export type FeedbackKind = "ok" | "error";

// Result/error feedback tied to an action: persistent (it stays until the next
// render), and able to carry a diagnostic detail line.
export function feedback(kind: FeedbackKind, message: string, detail?: string): HTMLElement {
  const node = element("div", kind === "error" ? "ui-feedback ui-feedback--error" : "ui-feedback ui-feedback--ok");
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.append(element("span", undefined, message));
  if (detail) {
    node.append(element("span", "ui-feedback-detail", detail));
  }
  return node;
}

// Placeholder card shown in a slot whose content is empty, unsupported, or
// unavailable. Keeps the slot's position so the layout does not collapse.
export function placeholder(message: string): HTMLElement {
  return element("div", "ui-placeholder", message);
}

// Shimmering placeholder bar shown before the first query or while content loads,
// so a page is never blank. Decorative, so hidden from assistive tech.
export function skeleton(options: { variant?: "title" | "line" | "block"; width?: "40" | "60" | "80" } = {}): HTMLElement {
  const width = options.width ? ` ui-skeleton--w${options.width}` : "";
  const node = element("div", `ui-skeleton ui-skeleton--${options.variant ?? "line"}${width}`);
  node.setAttribute("aria-hidden", "true");
  return node;
}

// Prompt shown with an empty/loading skeleton: the readable instruction (what to
// enter) or status (loading) over the quiet ghost.
export function skeletonHint(text: string): HTMLElement {
  return element("div", "ui-skeleton-hint", text);
}

// A label/value pair of skeleton bars matching the .ui-row grid, for previewing a
// key/value section while it loads.
export function skeletonRow(): HTMLElement {
  const node = element("div", "ui-skeleton-row");
  node.setAttribute("aria-hidden", "true");
  node.append(
    element("div", "ui-skeleton ui-skeleton--line ui-skeleton--w40"),
    element("div", "ui-skeleton ui-skeleton--line")
  );
  return node;
}

export function h1(text: string): HTMLElement {
  return element("h1", "ui-h1", text);
}

export function subtitle(text: string): HTMLElement {
  return element("p", "ui-subtitle", text);
}

// Quiet boundary/scope note (tier T4).
export function note(text: string): HTMLElement {
  return element("p", "ui-note", text);
}

export type WarningToastTone = "warning" | "error" | "info";

// An alert toast: a tone-coloured bar carrying one warning/error/info message. It is
// placed by the caller per the UI's toast policy — between a card's head and its
// content when the alert belongs to that card, or directly under the page header
// when it concerns the whole view — never as a bare line floating between cards.
export function warningToast(tone: WarningToastTone, message: string): HTMLElement {
  const node = element("div", `ui-toast ui-toast--${tone}`, message);
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  return node;
}

// Page footer: the consistent bottom slot for a page's boundary/disclaimer notes,
// so every page carries its scope statement in the same place and style.
export function footer(notes: string[]): HTMLElement {
  const node = element("footer", "ui-footer");
  for (const text of notes) {
    node.append(note(text));
  }
  return node;
}

// Page header: title + description on the left, an optional control (e.g. a search
// field) aligned to the right; stacks on narrow widths. One layout for every
// title-with-search page.
export function pageHeader(options: { title: string; lede: string; ledeTip?: string; aside?: HTMLElement }): HTMLElement {
  const head = element("div", "ui-page-head");
  const lead = element("div", "ui-page-head-main");
  lead.append(h1(options.title));
  const lede = element("p", "ui-subtitle");
  if (options.ledeTip) {
    lede.append(`${options.lede} `, info(options.ledeTip));
  } else {
    lede.textContent = options.lede;
  }
  lead.append(lede);
  head.append(lead);
  if (options.aside) {
    const aside = element("div", "ui-page-head-aside");
    aside.append(options.aside);
    head.append(aside);
  }
  return head;
}

// Monospace span for ids, addresses, and digests.
export function mono(text: string): HTMLElement {
  return element("span", "ui-mono", text);
}

// Compact address/hash with its complete value available to readers.
export function monoShort(value: string): HTMLElement {
  const node = mono(shortHex(value));
  node.title = value;
  node.setAttribute("aria-label", value);
  node.tabIndex = 0;
  return node;
}

// Inline info marker. Keeps the visible copy minimal while the full detail is a
// hover/focus tooltip (and is exposed to assistive tech via aria-label).
export function info(detail: string): HTMLElement {
  const node = element("span", "ui-info", "i");
  node.title = detail;
  node.setAttribute("aria-label", detail);
  node.setAttribute("role", "img");
  node.tabIndex = 0;
  return node;
}

// Single source for copy-to-clipboard with transient confirmation. Wired onto any
// button element so the shared copyButton atom and not-yet-migrated pages (which
// style their own bare button) share one behavior. Restores the button's prior
// label after the confirmation.
export function copyToClipboard(target: HTMLButtonElement, getText: () => string, copiedLabel: string): void {
  const idle = target.textContent ?? "";
  void navigator.clipboard
    .writeText(getText())
    .then(() => {
      target.textContent = copiedLabel;
      target.disabled = true;
      window.setTimeout(() => {
        target.textContent = idle;
        target.disabled = false;
      }, 1500);
    })
    .catch(() => {
      // Clipboard unavailable; leave the button unchanged.
    });
}

// Secondary button that copies text to the clipboard and briefly confirms. The
// text is produced lazily so the caller serializes current state at click time.
export function copyButton(label: string, getText: () => string, copiedLabel: string): HTMLButtonElement {
  const node = button(label, () => copyToClipboard(node, getText, copiedLabel), "secondary");
  return node;
}

// A copy action as a title-bar icon (copy → check confirmation), for card heads where a
// full-width text button would be too heavy. Shares the COPY/CHECK icons with the graph card.
export function copyIconButton(getText: () => string, ariaLabel: string): HTMLButtonElement {
  const node = iconButton(COPY_ICON, ariaLabel, () => {
    void navigator.clipboard
      .writeText(getText())
      .then(() => {
        node.innerHTML = CHECK_ICON;
        setTimeout(() => {
          node.innerHTML = COPY_ICON;
        }, 1500);
      })
      .catch(() => window.prompt(ariaLabel, getText()));
  });
  return node;
}

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

// Search field: one control with the input and a magnifier button inside it on
// the right. `onSearch` fires on the button or Enter.
export function searchField(options: {
  value?: string;
  placeholder?: string;
  ariaLabel: string;
  onSearch: (value: string) => void;
}): HTMLElement {
  const wrap = element("div", "ui-search");
  const control = input({ value: options.value ?? "", placeholder: options.placeholder ?? "" });
  control.spellcheck = false;
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "ui-search-btn";
  submit.setAttribute("aria-label", options.ariaLabel);
  submit.innerHTML = SEARCH_ICON;
  submit.addEventListener("click", () => options.onSearch(control.value));
  control.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      options.onSearch(control.value);
    }
  });
  wrap.append(control, submit);
  return wrap;
}
