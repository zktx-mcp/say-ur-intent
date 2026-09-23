import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CARD_METADATA_KEY, CARD_DISPLAY_METADATA_KEY, CARD_RESOURCE_PREFIX, CARD_TOOLS,
  cardReferenceSchema, cardSnapshotSchema, cardReceiptDisplaySchema,
  type CardKind, type CardReference, type CardSnapshot, type CardReceiptDisplay } from "../contracts.js";
import "../../../review-app/public/ui.css";
import "./style.css";

declare const __SAY_UR_INTENT_VERSION__: string;
export type CardRenderer = {
  title: string;
  controls(snapshot: CardSnapshot, submit: (input: Record<string, unknown>) => void): HTMLElement;
  result(snapshot: CardSnapshot, display?: CardReceiptDisplay): {
    node: HTMLElement;
    // Called after insertion; renderers still own any layout-size prerequisites.
    mount?: () => void;
    dispose?: () => void;
  };
};
function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function unwrap(result: unknown, host: string | undefined): Record<string, unknown> {
  const record = object(result);
  if (!record) throw new Error("Card response is unavailable.");
  if (record.structuredContent !== undefined) return record;
  if (Array.isArray(record.content)) for (const entry of record.content) {
    const text = object(entry);
    if (text?.type !== "text" || typeof text.text !== "string") continue;
    let parsed: Record<string, unknown> | undefined;
    try { parsed = object(JSON.parse(text.text)); } catch { continue; }
    if (parsed?.ok !== undefined) return { ...record, structuredContent: parsed };
    // The qualified Codex host wraps the MCP result in a JSON text block.
    if (host === "chatgpt" && parsed && Array.isArray(parsed.content)) return unwrap(parsed, undefined);
  }
  return record;
}
function responseParts(result: Record<string, unknown>) {
  const payload = object(result.structuredContent);
  const error = object(object(payload?.error)?.details);
  const value = payload?.ok === true ? payload.data : error?.snapshot;
  const snapshot = value === undefined ? undefined : cardSnapshotSchema.parse(value);
  const privateValue = object(result._meta)?.[CARD_DISPLAY_METADATA_KEY];
  const display = privateValue === undefined ? undefined : cardReceiptDisplaySchema.parse(privateValue);
  if (display && (!snapshot || snapshot.kind !== "receipt" || display.cardId !== snapshot.cardId ||
      display.revision !== snapshot.revision || display.transactionDigest !== snapshot.input.digest)) {
    throw new Error("Receipt display details do not match this saved result.");
  }
  return { snapshot, display, error: typeof error?.reason === "string" ? error.reason : undefined };
}

export function startCard(kind: CardKind, renderer: CardRenderer): void {
  const root = document.getElementById("app");
  if (!root) throw new Error("Card root is unavailable.");
  const heading = document.createElement("h1"); heading.textContent = renderer.title;
  const status = document.createElement("p"); status.className = "ui-note"; status.setAttribute("role", "status");
  const issue = document.createElement("p"); issue.className = "ui-error"; issue.setAttribute("role", "alert");
  const content = document.createElement("section");
  const actions = document.createElement("div"); actions.className = "card-actions";
  root.replaceChildren(heading, status, issue, content, actions);
  status.textContent = "Opening card…";
  const app = new App({ name: "say-ur-intent-card", version: __SAY_UR_INTENT_VERSION__ }, {}, { autoResize: true, strict: true });
  const lifetime = new AbortController();
  let reference: CardReference | undefined;
  let snapshot: CardSnapshot | undefined;
  let display: CardReceiptDisplay | undefined;
  let connected = false;
  let creating: unknown;
  let initialized = false;
  let confirmed = false;
  let invalidIdentity = false;
  let busy = false;
  let reading: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let disposeResult: (() => void) | undefined;
  let renderedKey: string | undefined;
  let attemptedKey: string | undefined;
  let displayedInput = false;
  let operationError: string | undefined;
  let displayError: string | undefined;
  let recovery: HTMLButtonElement | undefined;

  function stopTimers(): void {
    if (timer !== undefined) clearTimeout(timer);
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    timer = undefined; expiryTimer = undefined;
  }
  function canSubmit(): boolean {
    return !!reference && confirmed && !busy && !invalidIdentity && !displayError &&
      !lifetime.signal.aborted && snapshot?.state === "ready" && displayedInput;
  }
  function updateChrome(): void {
    if (snapshot) status.textContent = invalidIdentity ? "Card unavailable" :
      snapshot.state === "running" ? "Reading the requested data…" :
      snapshot.state === "ready" ? (confirmed && reference ? "Choose the input for this card." : "Input is unavailable until the current state and permission are confirmed.") :
      snapshot.reason === "completed" ? "Saved result" : snapshot.error ??
      (snapshot.reason === "expired" ? "The input period has expired. Request a new card." :
        snapshot.reason === "server_restarted" ? "The server restarted before this request completed. Request a new card." : "This selection is closed.");
    issue.textContent = [operationError, displayError].filter(Boolean).join(" ");
    // A failed replacement may leave the old input form visible. Its controls
    // must stay disabled even if the current DB state is now closed.
    if (displayedInput) for (const control of content.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")) {
      control.disabled = !canSubmit();
    }
  }
  function release(dispose: (() => void) | undefined): void {
    try { dispose?.(); }
    catch { displayError = "Card display cleanup failed. Reopen this same card; its stored state is unchanged."; }
  }
  function render(retryFailed: boolean): void {
    if (!snapshot || lifetime.signal.aborted) return;
    // A creating response is a display snapshot, never input authority.
    if (snapshot.state === "ready" && !confirmed) return;
    if (snapshot.state === "running") { displayError = undefined; return; }
    const key = `${snapshot.revision}:${reference !== undefined}:${display !== undefined}`;
    if (key === renderedKey || (key === attemptedKey && !retryFailed)) return;
    attemptedKey = key;
    const previousNodes = [...content.children];
    let candidate: ReturnType<CardRenderer["result"]> | undefined;
    let nextInput = false;
    let inserted = false;
    try {
      if (snapshot.state === "ready" && reference) {
        candidate = { node: renderer.controls(snapshot, (input) => { void submit(input); }) };
        nextInput = true;
      } else if (snapshot.reason === "completed" && snapshot.data !== undefined) {
        candidate = renderer.result(snapshot, display);
      }
      content.replaceChildren(...(candidate ? [candidate.node] : [])); inserted = true;
      candidate?.mount?.();
    } catch {
      if (inserted) content.replaceChildren(...previousNodes);
      release(candidate?.dispose);
      displayError = "This card could not be displayed. Reopen this same card; its stored state is unchanged.";
      return;
    }
    const previousDispose = disposeResult;
    disposeResult = candidate?.dispose;
    displayedInput = nextInput;
    renderedKey = key;
    displayError = undefined;
    release(previousDispose);
  }
  function apply(next: CardSnapshot, details: CardReceiptDisplay | undefined, current: boolean): void {
    if (lifetime.signal.aborted || invalidIdentity) return;
    if (next.kind !== kind || (snapshot !== undefined && next.cardId !== snapshot.cardId) ||
        (reference && reference.cardId !== next.cardId)) {
      invalidIdentity = true;
      throw new Error("Card identity changed.");
    }
    if (snapshot && next.revision < snapshot.revision) return;
    const firstConfirmation = current && !confirmed;
    if (!snapshot || next.revision !== snapshot.revision) display = undefined;
    snapshot = next;
    if (details) display = details;
    confirmed = current;
    stopTimers();
    // Presentation errors cannot invalidate a DB reply or prevent its normal
    // expiry/progress observation. They never trigger an extra read or submit.
    render(firstConfirmation);
    updateChrome();
    if (!current || !reference) return;
    if (next.state === "ready") {
      expiryTimer = setTimeout(() => {
        confirmed = false; updateChrome(); void readSaved();
      }, next.inputRemainingMs);
    } else if (next.state === "running") {
      timer = setTimeout(() => { void readSaved(); }, next.pollAfterMs);
    }
  }
  async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return unwrap(await app.callServerTool({ name, arguments: args }, { signal: lifetime.signal }), app.getHostVersion()?.name);
  }
  function offerRead(): void {
    if (!reference || recovery || lifetime.signal.aborted || invalidIdentity) return;
    recovery = document.createElement("button"); recovery.textContent = "Read saved state";
    recovery.addEventListener("click", () => { void readSaved(); }); actions.append(recovery);
  }
  function readSaved(): Promise<void> {
    if (reading) return reading;
    if (!reference || lifetime.signal.aborted || invalidIdentity) return Promise.resolve();
    reading = (async () => {
      try {
        const result = responseParts(await call(CARD_TOOLS.read, reference!));
        if (lifetime.signal.aborted || invalidIdentity) return;
        if (!result.snapshot) throw new Error(result.error ?? "Saved card data is unavailable.");
        operationError = result.error;
        apply(result.snapshot, result.display, true);
        recovery?.remove(); recovery = undefined;
      } catch (error) {
        if (lifetime.signal.aborted) return;
        confirmed = false; stopTimers();
        operationError = error instanceof Error ? error.message : "Saved card data could not be read. The last displayed result is unchanged.";
        // No renderer call from error handling. Only an explicit recovery action
        // retries this state read; a failed read cannot schedule another one.
        updateChrome(); offerRead();
      }
    })().finally(() => { reading = undefined; });
    return reading;
  }
  async function submit(input: Record<string, unknown>): Promise<void> {
    if (!snapshot || !reference || !canSubmit()) return;
    busy = true; stopTimers(); operationError = undefined; updateChrome();
    try {
      const result = responseParts(await call(CARD_TOOLS.submit, { ...reference, revision: snapshot.revision, input }));
      if (lifetime.signal.aborted || invalidIdentity) return;
      if (!result.snapshot) throw new Error(result.error ?? "The request could not be confirmed.");
      operationError = result.error;
      apply(result.snapshot, result.display, true);
    } catch (error) {
      if (!lifetime.signal.aborted) {
        confirmed = false; stopTimers();
        operationError = error instanceof Error ? error.message : "The request could not be confirmed.";
        updateChrome();
        // Transport/response failure leaves admission unknown. A display failure
        // is contained by render() and never reaches this recovery path.
        await readSaved();
      }
    } finally {
      busy = false;
      if (!lifetime.signal.aborted) updateChrome();
    }
  }
  async function initialize(): Promise<void> {
    if (!connected || creating === undefined || initialized) return;
    initialized = true;
    try {
      const result = unwrap(creating, app.getHostVersion()?.name);
      const privateResult = cardReferenceSchema.safeParse(object(result._meta)?.[CARD_METADATA_KEY]);
      if (privateResult.success) reference = privateResult.data;
      const initial = responseParts(result);
      let next = initial.snapshot;
      if (!next) {
        let uri: string | undefined;
        for (const item of Array.isArray(result.content) ? result.content : []) {
          const link = object(item);
          if (link?.type === "resource_link" && typeof link.uri === "string" && link.uri.startsWith(CARD_RESOURCE_PREFIX)) uri = link.uri;
          if (app.getHostVersion()?.name === "Claude" && link?.type === "text" && typeof link.text === "string") {
            const match = /^\[Resource link: card_([A-Za-z0-9_-]+)\] (sayurintent:\/\/cards\/([A-Za-z0-9_-]+)) \(Saved data for this exact card\.\)$/.exec(link.text);
            if (match && match[1] === match[3]) uri = match[2];
          }
        }
        if (!uri) throw new Error("Card data is unavailable.");
        const saved = await app.readServerResource({ uri });
        const item = saved.contents.find((entry) => entry.uri === uri && "text" in entry);
        if (!item || !("text" in item)) throw new Error("Saved card data is unavailable.");
        next = cardSnapshotSchema.parse(JSON.parse(item.text));
      }
      apply(next, initial.display, false);
      if (reference) await readSaved();
      else if (next.state !== "closed") { operationError = "The host did not provide this card's input permission."; updateChrome(); }
    } catch (error) {
      if (lifetime.signal.aborted) return;
      confirmed = false; stopTimers(); status.textContent = "Card unavailable";
      operationError = error instanceof Error ? error.message : "Card data could not be read.";
      updateChrome(); offerRead();
    }
  }
  app.ontoolresult = (result: CallToolResult) => {
    if (creating === undefined) { creating = result; void initialize(); return; }
    try {
      const first = responseParts(unwrap(creating, app.getHostVersion()?.name)).snapshot ?? snapshot;
      const next = responseParts(unwrap(result, app.getHostVersion()?.name)).snapshot;
      if (first && next && (first.cardId !== next.cardId || first.kind !== next.kind)) throw new Error("The host sent a different card.");
      // Replayed creating responses do not overwrite the current DB revision.
    } catch {
      invalidIdentity = true; confirmed = false; stopTimers();
      operationError = "The card response does not match this card. Request a new card.";
      updateChrome();
    }
  };
  app.onhostcontextchanged = (context) => { if (context.theme) document.documentElement.dataset.theme = context.theme; };
  app.onteardown = async () => {
    if (lifetime.signal.aborted) return {};
    confirmed = false; stopTimers(); lifetime.abort();
    const dispose = disposeResult; disposeResult = undefined; release(dispose);
    updateChrome();
    return {};
  };
  void app.connect().then(() => {
    if (lifetime.signal.aborted) return;
    connected = true; document.documentElement.dataset.theme = app.getHostContext()?.theme ?? "light";
    void initialize();
  }).catch(() => { if (!lifetime.signal.aborted) { status.textContent = "Card connection unavailable"; offerRead(); } });
}
