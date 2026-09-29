import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CARD_METADATA_KEY, CARD_DISPLAY_METADATA_KEY, WALLET_DISPLAY_METADATA_KEY, CARD_RESOURCE_PREFIX, CARD_TOOLS,
  cardReferenceSchema, cardSnapshotSchema, cardReceiptDisplaySchema, cardWalletDisplaySchema, cardInputRequiredSchema,
  type CardKind, type CardReference, type CardSnapshot, type CardReceiptDisplay, type CardWalletDisplay } from "../contracts.js";
import "../../../review-app/public/ui.css";
import "./style.css";

declare const __SAY_UR_INTENT_VERSION__: string;
export type CardContent = { node: HTMLElement; mount?: () => void; dispose?: () => void };
export type CardRenderer = {
  title: string;
  controls(snapshot: CardSnapshot, submit: (input: Record<string, unknown>) => void, display?: CardReceiptDisplay, wallet?: CardWalletDisplay): HTMLElement | CardContent;
  result(snapshot: CardSnapshot, display?: CardReceiptDisplay, act?: (input: Record<string, unknown>) => void, wallet?: CardWalletDisplay): {
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
  const inputRequired = payload?.ok === true ? cardInputRequiredSchema.safeParse(payload.data) : undefined;
  const error = object(object(payload?.error)?.details);
  const value = inputRequired?.success ? undefined : payload?.ok === true ? object(payload.data)?.card ?? payload.data : error?.snapshot;
  const snapshot = value === undefined ? undefined : cardSnapshotSchema.parse(value);
  const privateValue = object(result._meta)?.[CARD_DISPLAY_METADATA_KEY];
  const display = privateValue === undefined ? undefined : cardReceiptDisplaySchema.parse(privateValue);
  const request = object(object(snapshot?.data)?.request);
  if (display && (!snapshot || (snapshot.kind !== "receipt" && snapshot.kind !== "review") || display.cardId !== snapshot.cardId ||
      display.revision !== snapshot.revision || display.transactionDigest !== (snapshot.kind === "receipt" ? snapshot.input.digest : request?.transactionDigest) ||
      (snapshot.kind === "review" && display.attemptId !== request?.attemptId))) {
    throw new Error("Receipt display details do not match this saved result.");
  }
  const walletValue = object(result._meta)?.[WALLET_DISPLAY_METADATA_KEY];
  const wallet = walletValue === undefined ? undefined : cardWalletDisplaySchema.parse(walletValue);
  if (wallet && (!snapshot || snapshot.kind !== "connect" || wallet.cardId !== snapshot.cardId || wallet.revision !== snapshot.revision ||
      wallet.connectionId !== object(object(snapshot.data)?.connection)?.connectionId)) throw new Error("Pairing display does not match this card.");
  return { snapshot, display, wallet, inputRequired: inputRequired?.success ? inputRequired.data : undefined,
    error: typeof error?.message === "string" ? error.message : typeof error?.reason === "string" ? error.reason : undefined };
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
  let walletDisplay: CardWalletDisplay | undefined;
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
  const business = kind === "connect" || kind === "review";

  function stopTimers(): void {
    if (timer !== undefined) clearTimeout(timer);
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    timer = undefined; expiryTimer = undefined;
  }
  function canSubmit(): boolean {
    return !!reference && confirmed && !busy && !invalidIdentity && !displayError &&
      !lifetime.signal.aborted && snapshot?.state === "ready" && displayedInput;
  }
  function canAct(input?: Record<string, unknown>): boolean {
    const permitted = object(snapshot?.data)?.allowedActions;
    return business && !!reference && confirmed && !busy && !invalidIdentity && !displayError && !lifetime.signal.aborted &&
      Array.isArray(permitted) && (input ? permitted.includes(input.action) : permitted.length > 0);
  }
  function updateChrome(): void {
    const workflow = business ? object(snapshot?.data) : undefined;
    if (snapshot) {
      status.textContent = invalidIdentity ? "Card unavailable" :
        !confirmed && snapshot.state === "ready" ? "Actions are unavailable until the current state and permission are confirmed." :
        business ? (object(workflow?.progress)?.status === "unavailable" ? "Current progress is unavailable. The last recorded state is shown." :
          !workflow?.request && snapshot.state === "closed" && ["expired", "server_restarted", "cancelled"].includes(snapshot.reason ?? "")
            ? "This card no longer accepts actions. Open a new card to continue." : "") :
        snapshot.state === "running" ? "Reading the requested data…" :
        snapshot.reason === "completed" ? "" : snapshot.error ??
        (snapshot.reason === "expired" ? "The input period has expired. Request a new card." :
          snapshot.reason === "server_restarted" ? "The server restarted before this request completed. Request a new card." : "");
    }
    status.hidden = !status.textContent;
    issue.textContent = [operationError, displayError].filter(Boolean).join(" ");
    // A failed replacement may leave the old input form visible. Its controls
    // must stay disabled even if the current DB state is now closed.
    if (displayedInput) for (const control of content.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")) {
      if (!business || control.tagName !== "BUTTON" || control.dataset.cardAction !== undefined) {
        control.disabled = business ? !canAct() : !canSubmit();
      }
    }
    if (business) for (const control of content.querySelectorAll<HTMLButtonElement>("[data-card-action]")) control.disabled = !canAct();
  }
  function release(dispose: (() => void) | undefined): void {
    try { dispose?.(); }
    catch { displayError = "Card display cleanup failed. Reopen this same card; its stored state is unchanged."; }
  }
  function render(retryFailed: boolean): void {
    if (!snapshot || lifetime.signal.aborted) return;
    // A creating response is a display snapshot, never input authority.
    if (snapshot.state === "ready" && !confirmed) return;
    if (snapshot.state === "running" && !business) { displayError = undefined; return; }
    // Workflow projections include referenced connection/account facts. Those
    // may change while this already-consumed card's own revision stays fixed.
    // Remaining milliseconds affect timers, not the displayed content identity.
    const projection = business ? { ...object(snapshot.data), actionRemainingMs: undefined, nextStateReadAfterMs: undefined } : undefined;
    const key = `${snapshot.revision}:${reference !== undefined}:${display !== undefined}:${walletDisplay !== undefined}:${JSON.stringify(projection)}`;
    if (key === renderedKey || (key === attemptedKey && !retryFailed)) return;
    attemptedKey = key;
    const previousNodes = [...content.children];
    let candidate: ReturnType<CardRenderer["result"]> | undefined;
    let nextInput = false;
    let inserted = false;
    try {
      if (snapshot.state === "ready" && reference) {
        const controls = renderer.controls(snapshot, (input) => { void submit(input); }, display, walletDisplay);
        candidate = "node" in controls ? controls : { node: controls };
        nextInput = true;
      } else if ((business || snapshot.reason === "completed") && snapshot.data !== undefined) {
        candidate = renderer.result(snapshot, display, (input) => { void submit(input); }, walletDisplay);
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
  function apply(next: CardSnapshot, details: CardReceiptDisplay | undefined, current: boolean, wallet?: CardWalletDisplay): void {
    if (lifetime.signal.aborted || invalidIdentity) return;
    if (next.kind !== kind || (snapshot !== undefined && next.cardId !== snapshot.cardId) ||
        (reference && reference.cardId !== next.cardId)) {
      invalidIdentity = true;
      throw new Error("Card identity changed.");
    }
    if (snapshot && next.revision < snapshot.revision) return;
    const firstConfirmation = current && !confirmed;
    if (!snapshot || next.revision !== snapshot.revision) { display = undefined; walletDisplay = undefined; }
    snapshot = next;
    if (details) display = details;
    walletDisplay = wallet;
    confirmed = current;
    stopTimers();
    // Presentation errors cannot invalidate a DB reply or prevent its normal
    // expiry/progress observation. They never trigger an extra read or submit.
    render(firstConfirmation);
    updateChrome();
    if (!current || !reference) return;
    const data = object(next.data);
    if (business && object(data?.progress)?.status === "unavailable") offerRead();
    else { recovery?.remove(); recovery = undefined; }
    const remaining = business ? data?.actionRemainingMs : next.inputRemainingMs;
    const hasTimedActions = business ? Array.isArray(data?.allowedActions) && data.allowedActions.length > 0 : next.state === "ready";
    const nextRead = business ? data?.nextStateReadAfterMs : undefined;
    // A zero/elapsed hint cannot form a busy read loop. The backend response
    // already owns expiry; only positive future intervals schedule a wake-up.
    const deadlines = [hasTimedActions ? remaining : undefined, nextRead]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
    if (deadlines.length > 0) {
      expiryTimer = setTimeout(() => {
        confirmed = false; updateChrome(); void readSaved();
      }, Math.min(...deadlines));
    }
    if ((business && data?.observe === true) || (!business && next.state === "running")) {
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
        apply(result.snapshot, result.display, true, result.wallet);
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
    if (!snapshot || !reference || (business ? !canAct(input) : !canSubmit())) return;
    busy = true; stopTimers(); operationError = undefined; updateChrome();
    try {
      const result = responseParts(await call(business ? CARD_TOOLS.act : CARD_TOOLS.submit, { ...reference, revision: snapshot.revision, input }));
      if (lifetime.signal.aborted || invalidIdentity) return;
      if (!result.snapshot) throw new Error(result.error ?? "The request could not be confirmed.");
      operationError = result.error;
      apply(result.snapshot, result.display, true, result.wallet);
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
      if (initial.inputRequired) {
        if (initial.inputRequired.kind !== kind || reference) throw new Error("The input request does not match this card.");
        stopTimers();
        status.textContent = ""; issue.textContent = "";
        const message = document.createElement("p"); message.className = "ui-note";
        message.textContent = initial.inputRequired.message;
        content.replaceChildren(message); actions.replaceChildren();
        return;
      }
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
      apply(next, initial.display, false, initial.wallet);
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
