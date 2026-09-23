import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import "./review.css";
import { Transaction } from "@mysten/sui/transactions";
import { getWalletUniqueIdentifier, type UiWallet } from "@mysten/dapp-kit-core";
import { ptbGraphCard } from "./ui/ptbDiagram.js";
import { qualifiedName, rawToDisplay, shortHex, shortType, signedRawToDisplay, suiAmount, typeName } from "./format.js";
import { createLocalDAppKit, hasStoredWalletSelection, suiMainnetClient } from "./dappKitClient.js";
import { isWalletStandardUserRejected } from "./walletStatus.js";
import { readPageToken, tokenHeaders } from "./token.js";
import { accordion, button as uiButton, card, copyIconButton, detailItem, element, endRow, feedback, note, row, statusBanner, walletChip, warningToast } from "./ui/ui.js";
import { renderShell } from "./ui/shell.js";
import { chainReceiptView, gasRows } from "./ui/chainReceiptView.js";
import { parseReceipt } from "./receiptFacts.js";
import type { PublicChainReceipt } from "../../src/core/action/suiChainReceiptReader.js";

type GuardianCheck = {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail";
  message: string;
  source: "registry" | "quote" | "wallet" | "simulation" | "adapter" | "network" | "proposal";
};

type DisplayIntentAmount = {
  symbol: string;
  amount: string;
  amountKind: "display_intent";
  approx?: boolean;
};

type ProposalParty = {
  address?: string;
  label?: string;
};

type ProposalAmount = {
  amountDisplay: string;
  amountKind: "display_proposal";
  symbol?: string;
  coinType?: string;
  denomination?: string;
};

type ProposalReviewModel = {
  proposalId: string;
  proposalType: "payment" | "sui_action";
  proposalSource: {
    kind: string;
    name: string;
    reference?: string;
  };
  proposedAction: {
    kind: "payment" | "sui_action";
    title: string;
    purpose: string;
    network: "sui:mainnet";
    recipient?: ProposalParty;
    target?: string | Record<string, string>;
  };
  assetFlow: {
    outgoing: ProposalAmount[];
    expectedIncoming: ProposalAmount[];
    fees: ProposalAmount[];
  };
  recipients: ProposalParty[];
  targets: Array<string | Record<string, string>>;
  evidenceUsed: Array<{ id: string; label: string; source: string; summary: string }>;
  missingEvidence: Array<{ id: string; label: string; reason: string }>;
  requiredUserChoices: Array<{ id: string; label: string; reason: string }>;
  unsupportedClaims: Array<{ id: string; label: string; reason: string }>;
  rejectedExecutableFields: Array<{ fieldName: string; reason: string }>;
  freshness: {
    proposalCreatedAt: string;
    proposalExpiresAt?: string;
    evaluatedAt: string;
    status: string;
    reason: string;
  };
  blockingChecks: GuardianCheck[];
  nonSignableReason: {
    code: string;
    message: string;
    blockedCapabilities: string[];
  };
};

type ActionPlan = {
  id: string;
  actionKind: string;
  adapterId: string;
  protocol: string;
  title: string;
  summary: string;
  assetFlowPreview: {
    outgoing: DisplayIntentAmount[];
    expectedIncoming: DisplayIntentAmount[];
    minimumIncoming?: DisplayIntentAmount[];
    fees?: DisplayIntentAmount[];
  };
  reviewModel?: ProposalReviewModel;
  createdAt: string;
  preliminaryChecks?: GuardianCheck[];
};

type HumanReadableReviewEnvelope = {
  kind: string;
  proposedAction: {
    title: string;
    summary: string;
    actionKind: string;
    adapterId: string;
    protocol: string;
    network: "sui:mainnet";
  };
  recipients: Array<{ role: string; address: string }>;
  evidenceUsed: Array<{ id: string; label: string; source: string; summary: string }>;
  missingEvidence: Array<{ id: string; label: string; reason: string }>;
  requiredUserChoices: Array<{ id: string; label: string; reason: string }>;
  unsupportedClaims: Array<{ id: string; label: string; reason: string }>;
  freshness: { status: "current"; evaluatedAt: string; expiresAt: string; reason: string };
  blockingChecks: GuardianCheck[];
};

type SwapHumanReadableReview = HumanReadableReviewEnvelope & {
  kind: "swap_human_readable_review";
  assetFlow: {
    outgoing: HumanReviewAmount[];
    expectedIncoming: HumanReviewAmount[];
    minimumIncoming: HumanReviewAmount[];
    fees: HumanReviewAmount[];
  };
  targets: Array<{ kind: string; symbol: string; coinType: string; protocol: string; poolKey: string; direction: string }>;
};

type HumanReadableReview = SwapHumanReadableReview;

type TransactionSimulationSummary = {
  provider: "client.core.simulateTransaction";
  checksEnabled: boolean;
  success: boolean;
  gasCostSummary?: {
    computationCostRaw: string;
    storageCostRaw: string;
    storageRebateRaw: string;
    nonRefundableStorageFeeRaw: string;
  };
  balanceChanges?: Record<string, unknown>[];
  objectChanges?: Record<string, unknown>[];
  error?: string;
};

type ReviewState = {
  planId: string;
  reviewSessionId: string;
  account: string;
  status: "ready_for_wallet_review" | "refresh_required" | "blocked";
  blockedReason?: string;
  refreshReason?: string;
  adapterLifecycle?: {
    stageCatalogId: string;
    adapterId: string;
    protocol: string;
    actionKind: string;
    completedStages: string[];
    missingStages: string[];
  };
  humanReadableReview?: HumanReadableReview;
  simulation?: TransactionSimulationSummary;
  ptbVisualization?: PtbVisualizationArtifact;
  checks: GuardianCheck[];
  updatedAt: string;
};

type PtbVisualizationArtifact = {
  generatedAt: string;
  source: {
    adapterId: string;
    sourceKind: string;
    authority: string;
    renderer?: { name: string; packageName?: string; version?: string };
  };
  mermaid: { diagramType: string; text: string; namedText: string };
  diagnostics: Array<{ severity: string; code: string; message: string; source: string }>;
  unsupportedUse: string[];
};

type HumanReviewAmount = {
  role: string;
  symbol: string;
  coinType: string;
  decimals: number;
  rawAmount: string;
  rawAmountSource: string;
  displayAmount?: string;
  displayAmountSource?: string;
};

type ReviewSessionPayload = {
  reviewSessionId: string;
  internalStatus: string;
  pollingStatus: string;
  lastActivityAt: string;
  activeAccount?: {
    account: string;
    source: string;
    setAt: string;
    walletName?: string;
    walletId?: string;
  };
  reviewState?: ReviewState;
  signingInProgress?: boolean;
  // The review session's own TTL. Past this the session is gone server-side and no action
  // (refresh / start / sign) can run, so the page shows the terminal state on load.
  sessionExpiresAt?: string;
  executionResult?: {
    status: string;
    txDigest?: string;
    failureReason?: string;
    failureDetail?: string;
    chainReceipt?: {
      source?: { fetchedAt?: string };
      effectsStatus?: { success?: boolean };
      packageCalls?: Array<{ target?: string }>;
      accountBalanceChanges?: Array<{ coinType?: string; amountRaw?: string; direction?: string }>;
    };
    recordedAt?: string;
  };
  plans: ActionPlan[];
};

const root = document.querySelector<HTMLElement>("#review-app");
if (!root) {
  throw new Error("review app root missing");
}
const rootElement = root;
const reviewSessionId = rootElement.dataset.reviewSessionId ?? "";
const token = readPageToken();

let sessionPayload: ReviewSessionPayload | undefined;
let selectedPlanId: string | undefined;
let stateError: string | undefined;
// The result of the last review action (Start / Refresh / Run again), shown inline next
// to the button that triggered it - never the top toast. `terminal` means the session is
// gone (HTTP 410), so retrying cannot help and the button stays disabled.
let reviewActionError: { message: string; terminal: boolean } | undefined;
let loading = false;

const QUOTE_AUTOREFRESH_LEAD_S = 3;

const dAppKit = createLocalDAppKit();
dAppKit.stores.$wallets.subscribe(() => scheduleSignerRefresh());
dAppKit.stores.$connection.subscribe(() => scheduleSignerRefresh());
let isSigning = false;
let isConnecting = false;
let signNotice: { kind: "error" | "info"; text: string } | undefined;
let sessionGone = false;

// Avoid flashing the wallet picker in the signing section before dapp-kit's
// autoConnect resolves: when a wallet selection is stored, show a reconnecting
// placeholder until the connection settles (or a short timeout elapses).
let autoConnectSettling = hasStoredWalletSelection();
if (autoConnectSettling) {
  window.setTimeout(() => {
    autoConnectSettling = false;
    scheduleSignerRefresh();
  }, 2000);
}

// The shared shell in token mode (no navigation, brand not a link, theme toggle);
// the page renders into shell.main, which the render path clears and rebuilds.
const shell = renderShell(rootElement);
const main = shell.main;

// The post-sign Result state shows the same full on-chain receipt as the Receipt
// page, fetched by the execution digest and rendered with the shared component.
let resultReceipt: PublicChainReceipt | undefined;
let resultReceiptDigest: string | undefined;

// Wallet/connection store ticks only change the header wallet chip and the
// signing section. A full render() clears rootElement.innerHTML and rebuilds the
// whole page, which during signing resets the quote-countdown label, scroll
// position, expanded evidence, and focus. Batch these ticks into one scoped
// update of just those two regions and leave the rest of the page (and the
// countdown interval) intact. Stage/payload changes still drive full render()
// from their own call sites.
let signerRefreshHandle: number | undefined;
function scheduleSignerRefresh(): void {
  if (signerRefreshHandle !== undefined) {
    return;
  }
  signerRefreshHandle = window.requestAnimationFrame(() => {
    signerRefreshHandle = undefined;
    refreshSignerSurfaces();
  });
}

function refreshSignerSurfaces(): void {
  if (!sessionPayload) {
    return;
  }
  const signingEl = rootElement.querySelector(".signing-section");
  if (signingEl && sessionPayload.reviewState && pageStage(sessionPayload) === "ready") {
    fadeReplace(signingEl, renderSigningSection(sessionPayload.reviewState));
  }
  const walletEl = rootElement.querySelector(".header-wallet");
  if (walletEl) {
    fadeReplace(walletEl, renderHeaderWallet());
  }
}

// Swap a scoped region smoothly, but only when its content actually changed:
// short fade-out of the old node, then fade-in of the new one. Uses the Web
// Animations API so no inline opacity styles linger. Unchanged content is left
// untouched (isEqualNode), prefers-reduced-motion falls back to an instant swap,
// and an in-flight fade is canceled if a newer refresh arrives (the newer one
// owns the swap), so overlapping wallet ticks never double-swap.
const REGION_FADE_MS = 110;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function fadeReplace(oldEl: Element, newEl: HTMLElement): void {
  if (oldEl.isEqualNode(newEl)) {
    return;
  }
  if (prefersReducedMotion() || typeof oldEl.animate !== "function") {
    oldEl.replaceWith(newEl);
    return;
  }
  for (const animation of oldEl.getAnimations()) {
    animation.cancel();
  }
  const fadeOut = oldEl.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: REGION_FADE_MS,
    easing: "ease",
    fill: "forwards"
  });
  void fadeOut.finished
    .then(() => {
      oldEl.replaceWith(newEl);
      newEl.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: REGION_FADE_MS,
        easing: "ease"
      });
    })
    .catch(() => {
      // A newer refresh canceled this fade-out; that refresh owns the swap.
    });
}

// After a quote refresh that stays on the ready view, update only the value
// regions in place (fade-on-change) instead of rebuilding the whole page, which
// would re-flash the PTB graph and reset transient state. Any stage change (or a
// non-ready view) falls back to a full render.
function smartRender(): void {
  const canScope =
    !!sessionPayload &&
    pageStage(sessionPayload) === "ready" &&
    !!rootElement.querySelector(".transaction-card") &&
    !!rootElement.querySelector(".signing-section");
  if (canScope) {
    refreshReadyContent();
  } else {
    render();
  }
}

function refreshReadyContent(): void {
  if (!sessionPayload || !sessionPayload.reviewState || pageStage(sessionPayload) !== "ready") {
    return;
  }
  const txCard = rootElement.querySelector(".transaction-card");
  if (txCard) {
    fadeReplace(txCard, renderTransactionCard(sessionPayload));
  }
  // The always-visible Transaction details card keeps its quote-sensitive numbers (balance
  // changes, gas breakdown) in lockstep with the primary card; the PTB graph beside them is
  // left untouched so it does not rebuild on a tick.
  const detailsValues = rootElement.querySelector(".transaction-details-values");
  const freshDetailsValues = renderTransactionDetailsValues(sessionPayload.reviewState);
  if (detailsValues && freshDetailsValues) {
    fadeReplace(detailsValues, freshDetailsValues);
  }
  const findings = rootElement.querySelector(".ready-key-findings");
  if (findings) {
    fadeReplace(findings, renderReadyKeyFindings(sessionPayload.reviewState));
  }
  const signing = rootElement.querySelector(".signing-section");
  if (signing) {
    fadeReplace(signing, renderSigningSection(sessionPayload.reviewState));
  }
  // Restart the countdown against the refreshed freshness window.
  manageQuoteCountdown(pageStage(sessionPayload));
}

// The sign step is one self-maintaining state: run the review automatically on
// arrival so the user never presses "Start review" (or "Refresh"). Called after a
// render completes (not from within one) to avoid re-entrant rendering.
function maybeAutoStartReview(): void {
  if (loading || isSigning || !sessionPayload) {
    return;
  }
  if (pageStage(sessionPayload) === "pre_review") {
    void runAccountBoundReview();
  }
}

if (reviewSessionId && token) {
  void openAndLoadReview();
} else {
  render();
}

type PageStage =
  | "no_identity"
  | "pre_review"
  | "stopped"
  | "ready"
  | "expired_quote"
  | "signing"
  | "chain_wait"
  | "done"
  | "session_expired";

let quoteCountdownTimer: ReturnType<typeof setInterval> | undefined;

function reviewExpiresAtMs(payload: ReviewSessionPayload): number | undefined {
  const expiresAt = payload.reviewState?.humanReadableReview?.freshness.expiresAt;
  return expiresAt ? Date.parse(expiresAt) : undefined;
}

// The review session's own TTL (distinct from the per-quote freshness window): once it is
// in the past, the session is gone server-side, so the page surfaces the terminal state on
// load instead of offering a Refresh / Start button that is guaranteed to fail.
function isSessionExpired(payload: ReviewSessionPayload): boolean {
  return payload.sessionExpiresAt !== undefined && Date.now() > Date.parse(payload.sessionExpiresAt);
}

function pageStage(payload: ReviewSessionPayload): PageStage {
  if (sessionGone) {
    return "session_expired";
  }
  if (payload.executionResult || payload.internalStatus === "success" || payload.internalStatus === "failure") {
    return "done";
  }
  if (payload.internalStatus === "signed_pending_result") {
    return "chain_wait";
  }
  if (payload.signingInProgress || isSigning) {
    return "signing";
  }
  if (isSessionExpired(payload)) {
    return "session_expired";
  }
  if (payload.reviewState?.status === "ready_for_wallet_review") {
    const expiresAtMs = reviewExpiresAtMs(payload);
    if (expiresAtMs !== undefined && Date.now() > expiresAtMs) {
      return "expired_quote";
    }
    return "ready";
  }
  if (payload.reviewState) {
    return "stopped";
  }
  if (!payload.activeAccount) {
    return "no_identity";
  }
  return "pre_review";
}

const STAGE_HEADLINES: Record<PageStage, string> = {
  no_identity: "No active wallet account for this review - see the details below.",
  pre_review: "Start the review to check this transaction against live mainnet data.",
  stopped: "The review stopped - see the reason below, then run it again.",
  ready: "Ready to sign - check the summary, then sign in your wallet.",
  expired_quote: "The price quote expired. Your funds are safe - refresh to get a current quote.",
  signing: "Waiting for your wallet - approve or reject the request in the wallet popup.",
  chain_wait: "Signed - waiting for the chain result.",
  done: "This review session is finished - for another transaction, ask your AI client to prepare a new review.",
  session_expired: "This review session has expired. Ask your AI client for a new review."
};


/**
 * Header-resident wallet identity - read straight from the server review
 * session payload (the DB active account), which is the single source of
 * truth. The page never derives "who is connected" from the browser wallet
 * here; the small dot only reflects whether the browser signer is ready for
 * the signing step. This header has no connect controls; wallet
 * connect/disconnect lives on the connection page, and the signing section may
 * offer a targeted reconnect for the one recorded wallet (not a picker).
 */
function renderHeaderWallet(): HTMLElement {
  const slot = element("div", "header-wallet");
  const account = sessionPayload?.activeAccount;
  if (!account || sessionGone) {
    return slot;
  }
  const connection = dAppKit.stores.$connection.get();
  const signerReady = connection.status === "connected" && connection.account.address === account.account;
  const settling = autoConnectSettling || connection.status === "connecting";
  const signerStatus = signerReady ? "ready" : settling ? "settling" : "idle";
  slot.append(
    walletChip({
      address: account.account,
      signerStatus,
      ...(account.walletName ? { walletName: account.walletName } : {})
    })
  );
  if (settling && !signerReady) {
    slot.append(element("span", "status", "Reconnecting signer…"));
  }
  return slot;
}

function render(): void {
  const restore = captureTransientState();
  renderInner();
  restore();
}

// Make a full rebuild non-destructive: capture scroll position, which <details>
// sections are open, and the focused control before innerHTML is cleared, then
// restore them after the shell is rebuilt. Keyed by summary text / control label
// so it survives the rebuild without stable ids. Applies to every render()
// (reload, run-review, quote expiry, sign flow), not just wallet ticks.
function captureTransientState(): () => void {
  const scrollY = window.scrollY;
  const openDetails = new Set<string>();
  rootElement.querySelectorAll("details[open]").forEach((d) => {
    const key = d.querySelector("summary")?.textContent?.trim();
    if (key) {
      openDetails.add(key);
    }
  });
  const active = document.activeElement;
  const focusKey =
    active instanceof HTMLElement && rootElement.contains(active) && active.textContent?.trim()
      ? `${active.tagName}:${active.textContent.trim()}`
      : undefined;
  return () => {
    rootElement.querySelectorAll("details").forEach((d) => {
      const key = d.querySelector("summary")?.textContent?.trim();
      if (key && openDetails.has(key)) {
        d.open = true;
      }
    });
    if (scrollY > 0) {
      window.scrollTo({ top: scrollY });
    }
    if (focusKey) {
      const matches = Array.from(
        rootElement.querySelectorAll<HTMLElement>("button, summary, a[href], [tabindex]")
      ).filter((el) => `${el.tagName}:${el.textContent?.trim()}` === focusKey);
      if (matches.length === 1) {
        matches[0]?.focus({ preventScroll: true });
      }
    }
  };
}

function renderInner(): void {
  const content: HTMLElement[] = [renderReviewHeader()];
  if (stateError) {
    // Top-of-page toast - reserved for STATE problems (the review could not load, or the
    // session is invalid). A result from a button the user just pressed renders inline by
    // that button instead, never here.
    content.push(warningToast("error", stateError));
  }

  if (!reviewSessionId || !token) {
    content.push(element("p", "error", "Missing review session id or token. Open the review URL from your AI client again."));
    main.replaceChildren(...content);
    return;
  }

  if (!sessionPayload) {
    content.push(endRow(button("Reload review session", () => void loadReview(), "secondary")));
    main.replaceChildren(...content);
    return;
  }

  const stage = pageStage(sessionPayload);
  content.push(renderPhaseChevron(stage));
  content.push(element("h3", "stage-headline", STAGE_HEADLINES[stage]));
  manageQuoteCountdown(stage);
  content.push(renderTransactionCard(sessionPayload));

  switch (stage) {
    case "session_expired": {
      break;
    }
    case "done":
    case "chain_wait": {
      content.push(renderResultSection(sessionPayload));
      content.push(collapsedEvidence(sessionPayload, stage));
      break;
    }
    case "signing": {
      const panel = card("Signing in progress");
      panel.append(
        element(
          "p",
          undefined,
          "Your wallet shows exactly what will be signed. Nothing happens without your approval there."
        )
      );
      panel.append(element("p", undefined, "If you do not see the wallet popup, open your wallet extension - or cancel below."));
      const actions = element("div", "actions");
      actions.append(endRow(button("Cancel signing", () => void cancelSigning(), "secondary")));
      if (signNotice) {
        // Signing feedback sits with the cancel button, not in the top toast.
        actions.append(signNotice.kind === "error" ? feedback("error", signNotice.text) : note(signNotice.text));
      }
      panel.append(actions);
      content.push(panel);
      content.push(collapsedEvidence(sessionPayload, stage));
      break;
    }
    case "ready": {
      if (sessionPayload.reviewState) {
        const details = renderTransactionDetails(sessionPayload.reviewState);
        if (details) {
          content.push(details);
        }
        content.push(renderReadyKeyFindings(sessionPayload.reviewState));
        content.push(renderSigningSection(sessionPayload.reviewState));
      }
      content.push(collapsedEvidence(sessionPayload, stage));
      break;
    }
    case "expired_quote": {
      const panel = card("Quote expired");
      panel.append(
        element(
          "p",
          undefined,
          "Nothing was signed and no funds moved. Prices are only held for 30 seconds - refresh to continue."
        )
      );
      panel.append(reviewActionBlock("Refresh price quote"));
      content.push(panel);
      content.push(collapsedEvidence(sessionPayload, stage));
      break;
    }
    case "stopped": {
      content.push(renderStoppedPanel(sessionPayload));
      content.push(collapsedEvidence(sessionPayload, stage));
      break;
    }
    case "no_identity": {
      // Should not happen: a swap review is only created when an active wallet
      // account already exists (the prepare tool refuses otherwise), so the
      // review payload always carries that account. If it is missing, the
      // active account was cleared after the review was created - surface it as
      // an error rather than trying to connect from here.
      const panel = card("No active wallet account");
      panel.append(
        element(
          "p",
          "error",
          "This review has no active wallet account. The account was cleared after the review was created, so its checks cannot run."
        )
      );
      panel.append(
        element(
          "p",
          "boundary-note",
          "Connect a wallet from your AI client (session.create_wallet_identity) and prepare the review again. Wallet connection is not done on this review page."
        )
      );
      content.push(panel);
      break;
    }
    case "pre_review": {
      const plan = selectedPlan(sessionPayload);
      if (plan?.reviewModel) {
        const proposalCard = card("External proposal review");
        proposalCard.append(renderProposalReviewModel(plan.reviewModel));
        content.push(proposalCard);
      }
      content.push(reviewActionBlock("Start review"));
      content.push(collapsedEvidence(sessionPayload, stage));
      break;
    }
  }
  main.replaceChildren(...content);
}

// The review's page header inside the shell's main: the page subtitle and the
// active-account wallet chip. The shell header above carries the brand and theme
// toggle; identity lives in main, consistent with the receipt and settings pages.
function renderReviewHeader(): HTMLElement {
  const headerEl = element("div", "review-header");
  headerEl.append(element("p", "review-subtitle", "Transaction review and signing"));
  headerEl.append(renderHeaderWallet());
  return headerEl;
}

// The two-phase commit indicator (Ready -> Result) as a chevron. The brief
// post-sign wait stays in Ready (a loading state); only `done` is Result. The
// reversibility cue is the trust signal: before signing you can cancel freely;
// once signed it cannot be undone.
function renderPhaseChevron(stage: PageStage): HTMLElement {
  const wrap = element("div", "review-phases-wrap");
  const phases = element("div", "review-phases");
  const atResult = stage === "done";
  phases.append(
    element("span", `phase-chevron ${atResult ? "phase-chevron--done" : "phase-chevron--current"}`, "Ready")
  );
  phases.append(
    element(
      "span",
      `phase-chevron phase-chevron--last ${atResult ? "phase-chevron--current" : "phase-chevron--upcoming"}`,
      "Result"
    )
  );
  wrap.append(phases);
  const committed = stage === "chain_wait" || stage === "done";
  const expired = stage === "session_expired";
  wrap.append(
    element(
      "p",
      `review-reversibility ${committed ? "review-reversibility--committed" : "review-reversibility--reversible"}`,
      committed
        ? "Signed and submitted - this can't be undone."
        : expired
          ? "Nothing was committed and no funds moved - this review session expired."
          : "Nothing is committed yet - review freely and cancel anytime."
    )
  );
  return wrap;
}

// The post-sign Result section: the server's verification status, then the same
// full on-chain receipt the Receipt page shows (fetched by the execution digest),
// rendered with the shared chainReceiptView so a confirmed transaction reads the
// same everywhere.
function renderResultSection(payload: ReviewSessionPayload): HTMLElement {
  const wrap = element("div", "result-section");
  const result = payload.executionResult;
  if (!result) {
    return wrap;
  }
  const tone = result.status === "success" ? "success" : result.status === "failure" ? "failure" : "pending";
  const headline =
    result.status === "success"
      ? "Chain receipt verified."
      : result.status === "failure"
        ? headlineForFailureResult(result.failureReason)
        : "Signed - verifying on Sui mainnet.";
  wrap.append(statusBanner(tone, headline));
  if (result.failureDetail) {
    wrap.append(element("p", "boundary-note", result.failureDetail));
  }
  // Execution-record fields the public receipt does not carry — always shown so
  // they survive whether or not the full receipt loads.
  if (result.txDigest) {
    wrap.append(row("Transaction digest", result.txDigest));
  }
  if (result.recordedAt) {
    wrap.append(row("Recorded at", result.recordedAt));
  }
  if (result.failureReason) {
    wrap.append(row("Failure reason", result.failureReason));
  }
  // The on-chain receipt body: the full public receipt once it loads, the
  // already-recorded degraded receipt as the always-available fallback otherwise.
  // The fallback keeps the result complete when the public receipt fetch is slow
  // or fails, instead of leaving a stuck "loading" with no facts.
  if (result.txDigest && (result.status === "success" || result.status === "failure")) {
    if (resultReceipt && resultReceiptDigest === result.txDigest) {
      wrap.append(chainReceiptView(resultReceipt));
    } else {
      for (const node of renderDegradedReceipt(payload)) {
        wrap.append(node);
      }
      void loadResultReceipt(result.txDigest);
    }
  }
  wrap.append(
    element(
      "p",
      "boundary-note",
      "Execution result is recorded from the local server's Sui mainnet receipt read. It is not transaction bytes, signing data, or a guarantee of economic outcome."
    )
  );
  return wrap;
}

// The degraded receipt the server already recorded on the session (chain effects,
// account balance changes, package calls), plus the estimated PTB graph, shown
// until the full public receipt loads. Mirrors what the old result panel always
// rendered inline, so no receipt fact disappears on a fetch miss.
function renderDegradedReceipt(payload: ReviewSessionPayload): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const receipt = payload.executionResult?.chainReceipt;
  if (receipt?.source?.fetchedAt) {
    nodes.push(row("Receipt fetched at", receipt.source.fetchedAt));
  }
  if (receipt?.effectsStatus) {
    nodes.push(row("Chain effects", receipt.effectsStatus.success ? "Success" : "Failure"));
  }
  if (receipt?.packageCalls?.length) {
    nodes.push(renderFactList("Package calls", receipt.packageCalls.map((call) => call.target ?? "Unknown package call")));
  }
  if (receipt?.accountBalanceChanges?.length) {
    nodes.push(
      renderFactList(
        "Account balance changes",
        receipt.accountBalanceChanges.map(
          (change) => `${change.direction ?? "change"} ${change.amountRaw ?? "?"} raw (${shortType(change.coinType ?? "?")})`
        )
      )
    );
  }
  const ptb = payload.reviewState?.ptbVisualization;
  if (ptb) {
    nodes.push(renderPtbVisualization(ptb));
  }
  return nodes;
}

// Fetch the full public receipt by the execution digest (the same public,
// same-origin reader used by the internal Receipt card), then re-render so the Result state
// shows it. Best-effort: on failure the verification status banner still shows.
async function loadResultReceipt(digest: string): Promise<void> {
  if (resultReceiptDigest === digest) {
    return;
  }
  resultReceiptDigest = digest;
  resultReceipt = undefined;
  try {
    const response = await fetch(`/api/receipt?digest=${encodeURIComponent(digest)}`);
    if (response.ok) {
      const parsed = parseReceipt(await response.json());
      if (parsed) {
        resultReceipt = parsed;
      }
    }
  } catch {
    // Leave the receipt undefined; the verification status banner still shows.
  }
  render();
}

function manageQuoteCountdown(stage: PageStage): void {
  if (quoteCountdownTimer) {
    clearInterval(quoteCountdownTimer);
    quoteCountdownTimer = undefined;
  }
  if (stage !== "ready") {
    return;
  }
  const paint = (): void => {
    const expiresAtMs = sessionPayload ? reviewExpiresAtMs(sessionPayload) : undefined;
    const label = document.querySelector(".quote-countdown");
    if (expiresAtMs === undefined || !label) {
      return;
    }
    const secondsLeft = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
    label.textContent = `Quote valid for ${secondsLeft}s - it refreshes automatically; your funds stay safe.`;
    // Refresh shortly before expiry so a fresh quote replaces the values in place
    // (no expired screen). Never while signing or a request is already in flight.
    if (
      secondsLeft <= QUOTE_AUTOREFRESH_LEAD_S &&
      !loading &&
      !isSigning &&
      sessionPayload &&
      pageStage(sessionPayload) === "ready"
    ) {
      void runAccountBoundReview();
    }
  };
  // Paint immediately so a rebuilt countdown label is never blank for ~1s.
  paint();
  quoteCountdownTimer = setInterval(paint, 1000);
}

function renderStoppedPanel(payload: ReviewSessionPayload): HTMLElement {
  const panel = card("Why the review stopped");
  const state = payload.reviewState;
  const reason = state?.blockedReason ?? state?.refreshReason ?? "unknown";
  const friendly: Record<string, string> = {
    insufficient_balance: "The account does not hold enough assets for this swap - see the exact amounts below.",
    zero_expected_output: "The amount is too small for this pool minimum order size - try a larger amount.",
    quote_unavailable: "The pool could not quote this amount right now - it may be below the pool minimum, or the price source had a hiccup.",
    quote_stale: "The price quote expired. Running again fetches a fresh quote - your funds are safe.",
    object_resolution_failed: "Required on-chain objects could not be resolved while building the transaction. Running again usually resolves this."
  };
  const failingFirst = (state?.checks ?? []).find((check) => check.status === "fail");
  const reasonKey = String(reason);
  const detailKey = failingFirst && /zero_expected_output/.test(failingFirst.message) ? "zero_expected_output" : reasonKey;
  if (friendly[detailKey]) {
    panel.append(element("p", undefined, friendly[detailKey]));
  }
  panel.append(row("Reason", reasonKey));
  const failing = (state?.checks ?? []).filter((check) => check.status === "fail");
  for (const check of failing) {
    panel.append(element("p", "error", `${check.label}: ${check.message}`));
  }
  panel.append(reviewActionBlock("Run review again"));
  return panel;
}

function renderTransactionCard(payload: ReviewSessionPayload): HTMLElement {
  const plan = selectedPlan(payload);
  const review = payload.reviewState?.humanReadableReview;
  const swap = review && review.kind === "swap_human_readable_review" ? review : undefined;
  // Card title = the action summary (the policy's T1 "what is happening"): "Swap SUI → USDC",
  // or "Swap SUI + A → USDC + B" for multi-token, falling back to a generic title before the
  // human-readable review has resolved the symbols.
  const actionSummary = swap
    ? `Swap ${swap.assetFlow.outgoing.map((a) => a.symbol).join(" + ")} → ${swap.assetFlow.expectedIncoming.map((a) => a.symbol).join(" + ")}`
    : "Transaction";
  const panel = card(actionSummary);
  panel.classList.add("transaction-card");
  if (!plan) {
    panel.append(element("p", "error", "No action plan is available for this review session."));
    return panel;
  }
  const sendPreview = plan.assetFlowPreview.outgoing[0];
  const receivePreview = plan.assetFlowPreview.expectedIncoming[0];
  // The card is split into uniform labelled sections, each divided by a separator —
  // the transaction card's section policy. Sent tokens, received tokens, the network
  // fee, and routing all get the same label + divider treatment, so no group (gas
  // included) is delineated differently from the others.
  const sendItems: MoneyItem[] = swap
    ? swap.assetFlow.outgoing.map((a) => ({ symbol: a.symbol, amount: `-${rawToDisplay(a.rawAmount, a.decimals)}`, coinType: a.coinType }))
    : sendPreview
      ? [{ symbol: sendPreview.symbol, amount: sendPreview.amount }]
      : [];
  const receiveItems: MoneyItem[] = swap
    ? swap.assetFlow.expectedIncoming.map((a, index) => {
        const min = swap.assetFlow.minimumIncoming[index];
        return {
          symbol: a.symbol,
          amount: `+~${rawToDisplay(a.rawAmount, a.decimals)}`,
          coinType: a.coinType,
          ...(min ? { note: `at least ${rawToDisplay(min.rawAmount, min.decimals)} ${min.symbol} guaranteed` } : {})
        };
      })
    : receivePreview
      ? [{ symbol: receivePreview.symbol, amount: receivePreview.amount === "unknown" ? "amount confirmed after review" : receivePreview.amount }]
      : [];
  panel.append(reviewGroup("You send", moneyRows(sendItems, "down")));
  panel.append(reviewGroup("You receive", moneyRows(receiveItems, "up")));
  const gas = payload.reviewState?.simulation?.gasCostSummary;
  if (gas) {
    // The primary card shows one compact fee line; the computation/storage/rebate breakdown is
    // demoted into the Transaction details disclosure (renderTransactionDetails).
    panel.append(reviewGroup("Network fee", [row("Estimated total", suiAmount(netGasMist(gas).toString()))]));
  }
  const target = swap?.targets[0];
  const routing: HTMLElement[] = [row("Via", target ? `${target.protocol} ${target.poolKey}` : plan.protocol)];
  const fee = swap?.assetFlow.fees[0];
  if (fee) {
    const feeValue = BigInt(fee.rawAmount);
    routing.push(
      row(
        "Protocol fee",
        feeValue === 0n
          ? "Included in the rate (paid from the coin you send)"
          : `${rawToDisplay(fee.rawAmount, fee.decimals)} ${fee.symbol}`
      )
    );
  }
  const recipient = swap?.recipients.find((entry) => entry.role === "output_recipient");
  routing.push(
    row(
      "Receiving account",
      recipient
        ? `${shortHex(recipient.address)} (your connected account)`
        : payload.activeAccount
          ? `${shortHex(payload.activeAccount.account)} (your connected account)`
          : "your connected account"
    )
  );
  panel.append(reviewGroup("Routing", routing));
  return panel;
}

// The "Transaction details" card: the estimated balance changes, the gas breakdown, and the PTB
// graph, shown as their own always-visible card below the primary Transaction card — top-level
// cards do not collapse; only their nested accordions do. The balance + gas rows reuse the shared
// receipt-quality atoms (detailItem, gasRows) and the PTB reuses the shared graph card. The card
// lives outside the quote-refreshed region, so a quote tick never rebuilds the graph.
function renderTransactionDetails(state: ReviewState): HTMLElement | undefined {
  const ptb = state.ptbVisualization;
  const values = renderTransactionDetailsValues(state);
  if (!values && !ptb) {
    return undefined;
  }
  const panel = card("Transaction details");
  if (values) {
    panel.append(values);
  }
  if (ptb) {
    panel.append(renderPtbVisualization(ptb));
  }
  return panel;
}

// The quote-sensitive part of the Transaction details — the estimated balance changes and the
// gas breakdown — in its own refreshable region (.transaction-details-values), so a quote tick
// updates these user-facing numbers in lockstep with the primary card (refreshReadyContent
// re-renders this region). The PTB graph stays out of this region and out of the refresh, so it
// never rebuilds on a tick (the postmortem's flicker) — its encoded amounts are diagnostic only.
function renderTransactionDetailsValues(state: ReviewState): HTMLElement | undefined {
  const gas = state.simulation?.gasCostSummary;
  const balances = balanceChangeRows(state);
  if (!gas && balances.length === 0) {
    return undefined;
  }
  const wrap = element("div", "transaction-details-values");
  if (balances.length > 0) {
    const group = element("div", "review-group");
    group.append(element("p", "review-group-label", "Estimated balance changes"));
    for (const balanceRow of balances) {
      group.append(balanceRow);
    }
    wrap.append(group);
  }
  if (gas) {
    const group = element("div", "review-group");
    group.append(element("p", "review-group-label", "Network fee breakdown"));
    for (const gasRow of gasRows({
      totalMist: netGasMist(gas).toString(),
      computationMist: gas.computationCostRaw,
      storageMist: gas.storageCostRaw,
      storageRebateMist: gas.storageRebateRaw
    })) {
      group.append(gasRow);
    }
    wrap.append(group);
  }
  return wrap;
}

// Estimated net wallet balance changes for the reviewed account. The simulation's raw changes
// carry only { address, coinType, signed raw amount }, so symbol + decimals are resolved through
// a map built from the human-readable swap legs, keyed by the address-independent qualifiedName
// (so the lookup matches regardless of 0x-form). SUI is seeded as a fallback because gas is paid
// in SUI even when SUI is not a swap leg. Rendered receipt-style via the shared detailItem.
function balanceChangeRows(state: ReviewState): HTMLElement[] {
  const raw = state.simulation?.balanceChanges ?? [];
  if (raw.length === 0) {
    return [];
  }
  const review = state.humanReadableReview;
  const swap = review && review.kind === "swap_human_readable_review" ? review : undefined;
  const display = new Map<string, { symbol: string; decimals: number }>([["sui::SUI", { symbol: "SUI", decimals: 9 }]]);
  if (swap) {
    for (const leg of [
      ...swap.assetFlow.outgoing,
      ...swap.assetFlow.expectedIncoming,
      ...swap.assetFlow.minimumIncoming,
      ...swap.assetFlow.fees
    ]) {
      display.set(qualifiedName(leg.coinType), { symbol: leg.symbol, decimals: leg.decimals });
    }
  }
  const normalizedAccount = state.account.replace(/^0x/, "").replace(/^0+/, "").toLowerCase();
  const rows: HTMLElement[] = [];
  for (const change of raw) {
    const address = typeof change.address === "string" ? change.address : undefined;
    const coinType = typeof change.coinType === "string" ? change.coinType : undefined;
    const amount = typeof change.amount === "string" ? change.amount : undefined;
    if (!coinType || amount === undefined) {
      continue;
    }
    // Keep only the reviewed account's own wallet legs, not the pool's mirror side.
    if (address && address.replace(/^0x/, "").replace(/^0+/, "").toLowerCase() !== normalizedAccount) {
      continue;
    }
    const resolved = display.get(qualifiedName(coinType));
    const negative = amount.startsWith("-");
    const magnitude = resolved ? signedRawToDisplay(amount, resolved.decimals) : `${amount} (raw)`;
    rows.push(
      detailItem({
        title: resolved ? resolved.symbol : typeName(coinType),
        trailing: negative ? magnitude : `+${magnitude}`,
        trailingTone: negative ? "down" : "up",
        metas: [{ value: shortType(coinType), full: coinType }]
      })
    );
  }
  return rows;
}

type MoneyItem = { symbol: string; amount: string; coinType?: string; note?: string };

// One labelled group inside the transaction card: a quiet group label over its rows,
// divided from the next group by a hairline. A lighter treatment than a nested card, so the
// primary surface reads as a single card of grouped lines rather than cards within cards.
function reviewGroup(label: string, nodes: HTMLElement[]): HTMLElement {
  const group = element("div", "review-group");
  group.append(element("p", "review-group-label", label));
  for (const node of nodes) {
    group.append(node);
  }
  return group;
}

// Tinted token lines for a money section (sent = down/red, received = up/green), one
// per token so a section extends to several consumed or produced tokens. The symbol
// is a measured label and the amount carries the weight — not an oversized title.
function moneyRows(items: ReadonlyArray<MoneyItem>, tone: "up" | "down"): HTMLElement[] {
  if (items.length === 0) {
    return [element("p", "review-empty", "-")];
  }
  return items.map((item) => {
    const wrap = element("div", "money-row");
    const head = element("div", "money-row-head");
    head.append(element("span", "money-row-symbol", item.symbol));
    head.append(element("span", `money-row-amount money-row-amount--${tone}`, item.amount));
    wrap.append(head);
    if (item.coinType) {
      wrap.append(element("p", "money-row-meta", shortType(item.coinType)));
    }
    if (item.note) {
      wrap.append(element("p", "money-row-meta", item.note));
    }
    return wrap;
  });
}

// Net gas in MIST from a review-time simulation summary: computation + storage −
// rebate, the same figure the on-chain receipt reports as the gas total.
function netGasMist(gas: NonNullable<TransactionSimulationSummary["gasCostSummary"]>): bigint {
  const net = BigInt(gas.computationCostRaw) + BigInt(gas.storageCostRaw) - BigInt(gas.storageRebateRaw);
  return net < 0n ? 0n : net;
}

function renderReadyKeyFindings(state: ReviewState): HTMLElement {
  const wrapper = card("Review result");
  wrapper.classList.add("ready-key-findings");
  const passCount = state.checks.filter((check) => check.status === "pass").length;
  // The pass count IS the link to the list: the disclosure summary states the result,
  // and opening it reveals every check — the count is never a claim you cannot inspect.
  const checks = accordion(`All review checks passed (${passCount}/${state.checks.length})`);
  checks.details.querySelector("summary")?.prepend(element("span", "checks-pass-mark", "✓ "));
  checks.body.append(renderChecks("", state.checks));
  wrapper.append(checks.details);
  wrapper.append(
    element("p", "quote-countdown", "Quote valid for 30s - if it expires, just refresh; your funds stay safe.")
  );
  return wrapper;
}

function auditRecordMarkdown(payload: ReviewSessionPayload): string {
  const lines: string[] = [];
  const state = payload.reviewState;
  lines.push("# Say Ur Intent - review audit record");
  lines.push("");
  lines.push(`- Review session: ${payload.reviewSessionId}`);
  lines.push(`- Status: ${payload.pollingStatus}`);
  if (state) {
    lines.push(`- Updated at: ${state.updatedAt}`);
    lines.push(`- Review account: ${state.account}`);
  }
  if (payload.executionResult) {
    lines.push("");
    lines.push("## Execution result");
    lines.push(`- Status: ${payload.executionResult.status}`);
    if (payload.executionResult.txDigest) {
      lines.push(`- Transaction digest: ${payload.executionResult.txDigest}`);
    }
    if (payload.executionResult.failureReason) {
      lines.push(`- Failure reason: ${payload.executionResult.failureReason}`);
    }
    if (payload.executionResult.recordedAt) {
      lines.push(`- Recorded at: ${payload.executionResult.recordedAt}`);
    }
  }
  const review = state?.humanReadableReview;
  if (review && review.kind === "swap_human_readable_review") {
    lines.push("");
    lines.push("## Transaction");
    lines.push(`- Action: ${review.proposedAction.title}`);
    for (const [label, list] of [
      ["You send", review.assetFlow.outgoing],
      ["Expected incoming", review.assetFlow.expectedIncoming],
      ["Minimum incoming", review.assetFlow.minimumIncoming],
      ["Fees", review.assetFlow.fees]
    ] as const) {
      for (const amount of list) {
        lines.push(
          `- ${label}: ${rawToDisplay(amount.rawAmount, amount.decimals)} ${amount.symbol} (${amount.rawAmount} raw, ${amount.coinType})`
        );
      }
    }
    for (const recipient of review.recipients) {
      lines.push(`- Recipient (${recipient.role}): ${recipient.address}`);
    }
    const target = review.targets[0];
    if (target) {
      lines.push(`- Via: ${target.protocol} ${target.poolKey} (${target.direction})`);
    }
    lines.push(`- Freshness: ${review.freshness.status}, expires ${review.freshness.expiresAt}`);
    for (const item of review.evidenceUsed) {
      lines.push(`- Evidence used - ${item.label}: ${item.summary}`);
    }
    for (const item of review.missingEvidence) {
      lines.push(`- Missing evidence - ${item.label}: ${item.reason}`);
    }
    for (const item of review.requiredUserChoices) {
      lines.push(`- Required user choice - ${item.label}: ${item.reason}`);
    }
    for (const item of review.unsupportedClaims) {
      lines.push(`- Unsupported claim - ${item.label}: ${item.reason}`);
    }
  }
  const lifecycle = state?.adapterLifecycle;
  if (lifecycle) {
    lines.push("");
    lines.push("## Adapter lifecycle");
    lines.push(`- Adapter: ${lifecycle.adapterId} / ${lifecycle.protocol} / ${lifecycle.actionKind}`);
    lines.push(`- Stage catalog: ${lifecycle.stageCatalogId}`);
    lines.push(`- Completed: ${lifecycle.completedStages.join(", ") || "-"}`);
    lines.push(`- Missing: ${lifecycle.missingStages.join(", ") || "-"}`);
  }
  const simulation = state?.simulation;
  if (simulation) {
    lines.push("");
    lines.push("## Review-time simulation");
    lines.push(`- Provider: ${simulation.provider}`);
    lines.push(`- Success: ${simulation.success ? "yes" : "no"}`);
    if (simulation.gasCostSummary) {
      lines.push(
        `- Gas (raw): computation ${simulation.gasCostSummary.computationCostRaw}, storage ${simulation.gasCostSummary.storageCostRaw}, rebate ${simulation.gasCostSummary.storageRebateRaw}`
      );
    }
    const balanceChanges = simulation.balanceChanges ?? [];
    if (balanceChanges.length > 0) {
      lines.push(`- Balance changes (${balanceChanges.length}):`);
      for (const change of balanceChanges) {
        lines.push(`  - ${formatBalanceChange(change)}`);
      }
    }
    const objectChanges = simulation.objectChanges ?? [];
    if (objectChanges.length > 0) {
      lines.push(`- Object changes (${objectChanges.length}):`);
      for (const change of objectChanges) {
        lines.push(`  - ${formatObjectChange(change)}`);
      }
    }
    if (balanceChanges.length > 0 || objectChanges.length > 0) {
      lines.push("");
      lines.push("Raw records:");
      lines.push("```json");
      lines.push(JSON.stringify({ balanceChanges, objectChanges }, null, 2));
      lines.push("```");
    }
  }
  if (state?.ptbVisualization) {
    lines.push("");
    lines.push("## PTB visualization (Mermaid)");
    lines.push("```mermaid");
    lines.push(state.ptbVisualization.mermaid.text);
    lines.push("```");
  }
  if (state) {
    lines.push("");
    lines.push("## Checks");
    for (const check of state.checks) {
      lines.push(`- [${check.status}] ${check.id}: ${check.message}`);
    }
  }
  lines.push("");
  lines.push(
    "_Local pre-signing review evidence. Not transaction bytes, signing data, signing readiness, or execution safety._"
  );
  return lines.join("\n");
}

function collapsedEvidence(payload: ReviewSessionPayload, stage: PageStage): HTMLElement {
  // The "Audit record" card: an always-visible top-level card (no collapse) whose nested record
  // sections stay as inner disclosures. Copy-as-Markdown sits as an icon in the card's title bar,
  // since the card itself no longer has a summary toggle to host the action.
  const label = stage === "done" || stage === "chain_wait" ? "Audit record (final snapshot)" : "Audit record";
  const panel = card();
  const head = element("h2", "ui-card-head");
  head.append(element("span", undefined, label));
  head.append(copyIconButton(() => (sessionPayload ? auditRecordMarkdown(sessionPayload) : ""), "Copy audit record as Markdown"));
  panel.append(head);
  const state = payload.reviewState;
  // Nested record sections stay as inner disclosures; their body keeps the
  // .collapsible-records class only so the mono record lists stay styled.
  const sub = (title: string, content: HTMLElement): HTMLElement => {
    const section = accordion(title);
    section.body.classList.add("collapsible-records");
    section.body.append(content);
    return section.details;
  };
  panel.append(row("Review session", payload.reviewSessionId));
  if (state) {
    panel.append(row("Updated at", state.updatedAt));
    if (state.adapterLifecycle) {
      panel.append(sub("Adapter lifecycle", renderAdapterLifecycle(state.adapterLifecycle)));
    }
    if (state.humanReadableReview) {
      panel.append(
        sub(
          "Human-readable review (raw units)",
          renderHumanReadableReview(state.humanReadableReview, state.simulation !== undefined)
        )
      );
    }
    if (state.simulation) {
      panel.append(sub("Review-time simulation", renderSimulationSummary(state.simulation)));
    }
    panel.append(sub(`All checks (${state.checks.length})`, renderChecks("", state.checks)));
  } else {
    panel.append(element("p", undefined, "No review evidence recorded yet."));
  }
  return panel;
}

async function cancelSigning(): Promise<void> {
  try {
    await requestJson(`/api/review/${encodeURIComponent(reviewSessionId)}/handoff/cancel`, { method: "POST", body: "{}" });
    signNotice = { kind: "info", text: "Signing cancelled. Nothing was signed." };
  } catch (error) {
    signNotice = { kind: "error", text: messageForHttpError(error, "Could not cancel signing.") };
  }
  isSigning = false;
  await loadReview();
}

function headlineForFailureResult(failureReason: string | undefined): string {
  switch (failureReason) {
    case "chain_execution_failed":
      return "Chain receipt verified; execution failed.";
    case "chain_receipt_unavailable":
      return "Signed transaction digest was not found before the local receipt lookup window ended.";
    case "receipt_verification_failed":
      return "Chain receipt verification failed.";
    default:
      return "Transaction did not execute.";
  }
}

function renderProposalReviewModel(model: ProposalReviewModel): HTMLElement {
  const wrapper = element("div", "proposal-review");
  wrapper.append(element("h4", undefined, "Proposal review"));
  wrapper.append(row("Proposal id", model.proposalId));
  wrapper.append(row("Proposal source", `${model.proposalSource.kind}: ${model.proposalSource.name}`));
  if (model.proposalSource.reference) {
    wrapper.append(row("Source reference", model.proposalSource.reference));
  }
  wrapper.append(row("Purpose", model.proposedAction.purpose));
  wrapper.append(row("Network", model.proposedAction.network));
  if (model.proposedAction.recipient) {
    wrapper.append(row("Recipient", partyText(model.proposedAction.recipient)));
  }
  if (model.proposedAction.target) {
    wrapper.append(row("Target", targetText(model.proposedAction.target)));
  }
  wrapper.append(renderProposalAmountList("Proposal outgoing", model.assetFlow.outgoing));
  wrapper.append(renderProposalAmountList("Proposal expected incoming", model.assetFlow.expectedIncoming));
  wrapper.append(renderProposalAmountList("Proposal fees", model.assetFlow.fees));
  wrapper.append(renderFactList("Evidence used", model.evidenceUsed.map((item) => `${item.label}: ${item.summary}`)));
  wrapper.append(renderFactList("Missing evidence", model.missingEvidence.map((item) => `${item.label}: ${item.reason}`)));
  wrapper.append(
    renderFactList("Required user choices", model.requiredUserChoices.map((item) => `${item.label}: ${item.reason}`))
  );
  wrapper.append(
    renderFactList("Unsupported claims", model.unsupportedClaims.map((item) => `${item.label}: ${item.reason}`))
  );
  wrapper.append(row("Freshness", `${model.freshness.status}: ${model.freshness.reason}`));
  wrapper.append(row("Non-signable reason", model.nonSignableReason.message));
  wrapper.append(renderFactList("Blocked capabilities", model.nonSignableReason.blockedCapabilities));
  return wrapper;
}

function renderAdapterLifecycle(lifecycle: NonNullable<ReviewState["adapterLifecycle"]>): HTMLElement {
  const wrapper = element("div", "adapter-lifecycle");
  wrapper.append(element("h4", undefined, "Adapter lifecycle"));
  wrapper.append(row("Adapter", `${lifecycle.adapterId} / ${lifecycle.protocol} / ${lifecycle.actionKind}`));
  wrapper.append(row("Stage catalog", lifecycle.stageCatalogId));
  wrapper.append(renderFactList("Completed stages", lifecycle.completedStages));
  wrapper.append(renderFactList("Missing stages", lifecycle.missingStages));
  wrapper.append(
    element(
      "p",
      "boundary-note",
      "Local pre-signing review progress only."
    )
  );
  return wrapper;
}

function renderHumanReadableReview(review: HumanReadableReview, simulationCompleted: boolean): HTMLElement {
  const wrapper = element("div", "human-readable-review");
  wrapper.append(element("h4", undefined, "Human-readable review"));
  wrapper.append(row("Review kind", review.kind));
  wrapper.append(row("Action", review.proposedAction.title));
  wrapper.append(row("Summary", humanSummary(review.proposedAction.summary)));
  wrapper.append(row("Protocol", review.proposedAction.protocol));
  wrapper.append(row("Freshness", `${review.freshness.status}: ${review.freshness.reason}`));
  wrapper.append(row("Expires at", review.freshness.expiresAt));
  wrapper.append(renderHumanReadableReviewProjection(review));
  wrapper.append(renderFactList("Recipients", review.recipients.map((recipient) => `${recipient.role}: ${recipient.address}`)));
  wrapper.append(renderFactList("Evidence used", review.evidenceUsed.map((item) => `${item.label}: ${item.summary}`)));
  // The human-readable review evidence is a stage-time snapshot; once the
  // simulation evidence exists on the same state, its "simulation missing"
  // entries are resolved and would contradict the panel below.
  const missingEvidence = simulationCompleted
    ? review.missingEvidence.filter((item) => !/simulation/i.test(item.id) && !/simulation/i.test(item.label))
    : review.missingEvidence;
  wrapper.append(renderFactList("Missing evidence", missingEvidence.map((item) => `${item.label}: ${item.reason}`)));
  wrapper.append(renderFactList("Required user choices", review.requiredUserChoices.map((item) => `${item.label}: ${item.reason}`)));
  wrapper.append(renderFactList("Unsupported claims", review.unsupportedClaims.map((item) => `${item.label}: ${item.reason}`)));
  const blockingChecks = simulationCompleted
    ? review.blockingChecks.filter((check) => !/simulation/i.test(check.id))
    : review.blockingChecks;
  if (blockingChecks.length > 0) {
    wrapper.append(renderChecks("Human review blocking checks", blockingChecks));
  }
  wrapper.append(
    element(
      "p",
      "boundary-note",
      "Displayable pre-signing evidence only."
    )
  );
  return wrapper;
}

// The review's PTB graph through the one shared graph card — same "Transaction
// graph" title, name↔address eye toggle, and copy-source icon as the receipt. The
// review producer already emits both Mermaid versions, so it passes them straight in.
function renderPtbVisualization(artifact: PtbVisualizationArtifact): HTMLElement {
  return ptbGraphCard({ mermaid: { text: artifact.mermaid.text, namedText: artifact.mermaid.namedText } });
}

function renderSimulationSummary(simulation: TransactionSimulationSummary): HTMLElement {
  const wrapper = element("div", "simulation-summary");
  wrapper.append(element("h4", undefined, "Review-time simulation"));
  wrapper.append(row("Provider", simulation.provider));
  wrapper.append(row("Validation checks", simulation.checksEnabled ? "Enabled" : "Disabled"));
  wrapper.append(row("Simulation success", simulation.success ? "Yes" : "No"));
  if (simulation.gasCostSummary) {
    wrapper.append(
      renderFactList("Gas cost summary", [
        `Computation cost raw: ${simulation.gasCostSummary.computationCostRaw}`,
        `Storage cost raw: ${simulation.gasCostSummary.storageCostRaw}`,
        `Storage rebate raw: ${simulation.gasCostSummary.storageRebateRaw}`,
        `Non-refundable storage fee raw: ${simulation.gasCostSummary.nonRefundableStorageFeeRaw}`
      ])
    );
  }
  if (simulation.error) {
    wrapper.append(row("Simulation error", simulation.error));
  }
  wrapper.append(renderCollapsibleRecords("Balance changes", simulation.balanceChanges, formatBalanceChange));
  wrapper.append(renderCollapsibleRecords("Object changes", simulation.objectChanges, formatObjectChange));
  wrapper.append(
    element(
      "p",
      "boundary-note",
      "Redacted summary of private review-time simulation evidence."
    )
  );
  return wrapper;
}

const MCP_BOUNDARY_SENTENCE =
  /\s*This MCP response contains no sign action, signing data, transaction bytes, or signing readiness\.?/g;

// plan.summary doubles as MCP answer copy; the human page drops the
// MCP-audience sentence while leaving the stored data untouched.
function humanSummary(text: string): string {
  return text.replace(MCP_BOUNDARY_SENTENCE, "").trim();
}

function formatBalanceChange(record: Record<string, unknown>): string {
  const address = typeof record.address === "string" ? shortHex(record.address) : "?";
  const coinType = typeof record.coinType === "string" ? shortType(record.coinType) : "?";
  const amount = typeof record.amount === "string" ? record.amount : "?";
  return `${address}: ${amount.startsWith("-") ? amount : `+${amount}`} raw (${coinType})`;
}

function formatObjectChange(record: Record<string, unknown>): string {
  const op = typeof record.idOperation === "string" ? record.idOperation : "?";
  const objectType = typeof record.objectType === "string" ? shortType(record.objectType) : "?";
  const objectId = typeof record.objectId === "string" ? shortHex(record.objectId) : "?";
  return `${op}: ${objectType} (${objectId})`;
}

function renderCollapsibleRecords(
  title: string,
  records: Record<string, unknown>[] | undefined,
  format: (record: Record<string, unknown>) => string
): HTMLElement {
  const details = document.createElement("details");
  details.className = "collapsible-records";
  const summary = document.createElement("summary");
  summary.textContent = `${title} (${records?.length ?? 0})`;
  details.append(summary);
  if (!records || records.length === 0) {
    details.append(element("p", undefined, "None."));
    return details;
  }
  const list = document.createElement("ul");
  for (const record of records) {
    const item = document.createElement("li");
    item.textContent = format(record);
    list.append(item);
  }
  details.append(list);
  const raw = document.createElement("details");
  const rawSummary = document.createElement("summary");
  rawSummary.textContent = "Raw records";
  const pre = document.createElement("pre");
  pre.className = "collapsible-records-raw";
  pre.textContent = JSON.stringify(records, null, 2);
  raw.append(rawSummary, pre);
  details.append(raw);
  return details;
}

function renderHumanReadableReviewProjection(review: HumanReadableReview): HTMLElement {
  switch (review.kind) {
    case "swap_human_readable_review":
      return renderSwapHumanReadableReviewProjection(review);
  }
}

function renderSwapHumanReadableReviewProjection(review: SwapHumanReadableReview): HTMLElement {
  const wrapper = element("div", "human-readable-review-projection");
  wrapper.append(renderHumanReviewAmountList("Outgoing", review.assetFlow.outgoing));
  wrapper.append(renderHumanReviewAmountList("Expected incoming", review.assetFlow.expectedIncoming));
  wrapper.append(renderHumanReviewAmountList("Minimum incoming", review.assetFlow.minimumIncoming));
  wrapper.append(renderHumanReviewAmountList("Fees", review.assetFlow.fees));
  wrapper.append(renderFactList("Targets", review.targets.map((target) => `${target.kind}: ${target.symbol} via ${target.protocol} ${target.poolKey}`)));
  return wrapper;
}


async function openAndLoadReview(): Promise<void> {
  loading = true;
  render();
  try {
    await requestJson(`/api/review/${encodeURIComponent(reviewSessionId)}/opened`, { method: "POST", body: "{}" });
    await loadReview();
  } catch (error) {
    stateError = messageForHttpError(error, "The local review server did not accept this review session.");
    loading = false;
    render();
  }
}

async function loadReview(): Promise<void> {
  loading = true;
  render();
  try {
    sessionPayload = await requestJson<ReviewSessionPayload>(`/api/review/${encodeURIComponent(reviewSessionId)}`, {
      method: "GET"
    });
    selectedPlanId ??= sessionPayload.plans[0]?.id;
    stateError = undefined;
  } catch (error) {
    if (error instanceof HttpJsonRequestError && error.status === 410) {
      sessionGone = true;
    }
    stateError = messageForHttpError(error, "Could not load the review session.");
  } finally {
    loading = false;
    render();
    maybeAutoStartReview();
  }
}

async function runAccountBoundReview(): Promise<void> {
  const account = sessionPayload?.activeAccount?.account;
  const plan = sessionPayload ? selectedPlan(sessionPayload) : undefined;
  if (!account || !plan) return;
  loading = true;
  smartRender();
  try {
    const stateRequest = () =>
      requestJson<{ reviewState: ReviewState }>(`/api/review/${encodeURIComponent(reviewSessionId)}/state`, {
        method: "POST",
        body: JSON.stringify({ planId: plan.id, account })
      });
    let result;
    try {
      result = await stateRequest();
    } catch (error) {
      // A stale signing lock (e.g. the page reloaded past a hung wallet call)
      // refuses recomputes with 409. Cancel the outstanding handoff once and
      // retry instead of dead-ending the user.
      if (error instanceof HttpJsonRequestError && error.status === 409 && sessionPayload?.signingInProgress) {
        await requestJson(`/api/review/${encodeURIComponent(reviewSessionId)}/handoff/cancel`, {
          method: "POST",
          body: "{}"
        });
        result = await stateRequest();
      } else {
        throw error;
      }
    }
    sessionPayload = {
      ...(await requestJson<ReviewSessionPayload>(`/api/review/${encodeURIComponent(reviewSessionId)}`, {
        method: "GET"
      })),
      reviewState: result.reviewState
    };
    reviewActionError = undefined;
  } catch (error) {
    reviewActionError = {
      message: messageForHttpError(error, "Could not run the review."),
      terminal: error instanceof HttpJsonRequestError && error.status === 410
    };
  } finally {
    loading = false;
    smartRender();
  }
}

function renderSigningSection(state: ReviewState): HTMLElement {
  const wrapper = card("Wallet signing");
  wrapper.classList.add("signing-section");
  if (signNotice) {
    wrapper.append(signNotice.kind === "error" ? feedback("error", signNotice.text) : note(signNotice.text));
  }
  const connection = dAppKit.stores.$connection.get();
  const wallets = dAppKit.stores.$wallets.get();
  if (connection.status === "connected") {
    autoConnectSettling = false;
    if (connection.account.address !== state.account) {
      wrapper.append(
        feedback(
          "error",
          `Connected wallet account ${connection.account.address} does not match the reviewed account ${state.account}. Switch the wallet account before signing.`
        )
      );
    } else {
      wrapper.append(
        element(
          "p",
          undefined,
          "Signing hands the digest-verified transaction bytes to your wallet. Finish or cancel the request in your wallet popup."
        )
      );
      const sign = button(isSigning ? "Waiting for wallet" : "Sign in wallet", () => void signInWallet(state), "primary");
      sign.disabled = isSigning;
      wrapper.append(endRow(sign));
    }
  } else if (autoConnectSettling || connection.status === "connecting") {
    wrapper.append(note("Reconnecting your wallet…"));
  } else if (wallets.length === 0) {
    wrapper.append(feedback("error", "No compatible Sui wallet was detected in this browser."));
  } else {
    wrapper.append(
      feedback(
        "error",
        "Your wallet signer is not connected, so this transaction cannot be signed yet."
      )
    );
    const boundWallet = findBoundWallet(
      wallets,
      sessionPayload?.activeAccount?.walletId,
      sessionPayload?.activeAccount?.walletName
    );
    if (boundWallet) {
      // Reconnect resumes the recorded wallet's signer session for this review.
      // A new tab or reload drops the in-page connection (and, for a hardware
      // signer, its device session), so dapp-kit autoconnect cannot always
      // restore a signable session on its own. This targets the one recorded
      // wallet for the active account - it is not a wallet picker.
      wrapper.append(
        element(
          "p",
          "boundary-note",
          "Reconnect resumes the signer session for this review's wallet. Your wallet (or hardware device) asks you to approve the connection; nothing is signed until you press Sign."
        )
      );
      const walletLabel = sessionPayload?.activeAccount?.walletName ?? "wallet";
      const reconnect = button(
        isConnecting ? "Reconnecting…" : `Reconnect ${walletLabel} to sign`,
        () => void reconnectBoundWallet(boundWallet),
        "primary"
      );
      reconnect.disabled = isConnecting;
      wrapper.append(endRow(reconnect));
    } else {
      wrapper.append(
        element(
          "p",
          "boundary-note",
          "This review's wallet was not detected in this browser. Open the review where that wallet (or hardware device) is available, or connect it from your AI client (session.create_wallet_identity) and reopen this review."
        )
      );
    }
  }
  wrapper.append(
    element(
      "p",
      "boundary-note",
      "Signing happens in your wallet. This page never sees private keys; it hands over bytes whose recomputed digest equals the reviewed commitment."
    )
  );
  return wrapper;
}


async function signInWallet(state: ReviewState): Promise<void> {
  if (isSigning) return;
  isSigning = true;
  signNotice = { kind: "info", text: "Approve the request in your wallet. After approval this page submits the signed transaction and the local server verifies the receipt." };
  render();
  let handedOff = false;
  let signedDigestReported = false;
  try {
    const handoff = await requestJson<{ transactionBytesBase64: string; transactionMaterialCommitment: string }>(
      `/api/review/${encodeURIComponent(reviewSessionId)}/handoff`,
      { method: "POST", body: JSON.stringify({ planId: state.planId, account: state.account }) }
    );
    const bytes = base64ToBytes(handoff.transactionBytesBase64);
    const transaction = Transaction.from(bytes);
    const recomputed = await transaction.getDigest();
    if (recomputed !== handoff.transactionMaterialCommitment) {
      throw new Error("Handoff bytes do not match the reviewed transaction commitment.");
    }
    handedOff = true;
    // Sign and execute are separated on purpose: not every wallet exposes
    // sign-and-execute (Agent-Q signs only), and submitting from this page
    // works identically for every Wallet Standard signer.
    const signed = await withTimeout(
      dAppKit.signTransaction({ transaction }),
      90_000,
      "The wallet did not respond to the signing request within 90 seconds."
    );
    const signedBytes = base64ToBytes(signed.bytes);
    const signedDigest = await Transaction.from(signedBytes).getDigest();
    if (signedDigest !== handoff.transactionMaterialCommitment) {
      await postExecutionResult(state, { status: "failure", failureReason: "wallet_provider_error" });
      signNotice = {
        kind: "error",
        text: "The wallet returned bytes whose digest does not match the reviewed commitment; nothing was submitted."
      };
      return;
    }
    await postExecutionResult(state, { status: "signed_pending_result", txDigest: signedDigest });
    signedDigestReported = true;
    try {
      await suiMainnetClient.core.executeTransaction({
        transaction: signedBytes,
        signatures: [signed.signature],
        include: { effects: true }
      });
    } catch (submitError) {
      signNotice = {
        kind: "error",
        text: messageForHttpError(submitError, "The signed transaction could not be submitted from this page. The local server will mark the digest unavailable if it does not appear on Sui mainnet.")
      };
      return;
    }
    signNotice = { kind: "info", text: "Signed transaction submitted. Verifying the receipt on Sui mainnet." };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (handedOff && !signedDigestReported) {
      const failureReason = isWalletStandardUserRejected(error) ? "wallet_rejected" : "wallet_provider_error";
      try {
        await postExecutionResult(state, { status: "failure", failureReason });
      } catch {
        // The local result endpoint refused the failure record; surface the original error only.
      }
    }
    signNotice = { kind: "error", text: messageForHttpError(error, text) };
  } finally {
    isSigning = false;
    await loadReview();
  }
}

function findBoundWallet(
  wallets: readonly UiWallet[],
  walletId: string | undefined,
  walletName: string | undefined
): UiWallet | undefined {
  if (walletId) {
    const byId = wallets.find((wallet) => getWalletUniqueIdentifier(wallet) === walletId);
    if (byId) {
      return byId;
    }
  }
  if (walletName) {
    return wallets.find((wallet) => wallet.name === walletName);
  }
  return undefined;
}

// Resume the recorded wallet's signer session so the gated sign action can
// appear again after a reload or new tab dropped the in-page connection. The
// page only kicks off connectWallet; the browser, the wallet provider, and any
// hardware device handle the rest (port reuse or selection, then the
// device-local approval). When the connection settles, the $connection
// subscription re-renders and the sign action re-gates on the matching account.
async function reconnectBoundWallet(wallet: UiWallet): Promise<void> {
  if (isConnecting || isSigning) return;
  isConnecting = true;
  signNotice = undefined;
  render();
  try {
    await dAppKit.connectWallet({ wallet });
  } catch (error) {
    const fallback = isWalletStandardUserRejected(error)
      ? "Wallet connection was cancelled."
      : "The wallet could not be connected. Try again.";
    signNotice = { kind: "error", text: messageForHttpError(error, fallback) };
  } finally {
    isConnecting = false;
    render();
  }
}

async function postExecutionResult(
  state: ReviewState,
  body: { status: "signed_pending_result" | "failure"; txDigest?: string; failureReason?: string }
): Promise<void> {
  await requestJson(`/api/review/${encodeURIComponent(reviewSessionId)}/result`, {
    method: "POST",
    body: JSON.stringify({ planId: state.planId, ...body })
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function base64ToBytes(value: string): Uint8Array {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

async function requestJson<T = unknown>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: tokenHeaders(token, {
      "content-type": "application/json",
      ...((init.headers as Record<string, string> | undefined) ?? {})
    })
  });
  if (!response.ok) {
    throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
  }
  return (await response.json()) as T;
}

function selectedPlan(payload: ReviewSessionPayload): ActionPlan | undefined {
  return payload.plans.find((plan) => plan.id === selectedPlanId) ?? payload.plans[0];
}


function renderProposalAmountList(label: string, amounts: ProposalAmount[]): HTMLElement {
  const wrapper = element("div", "amount-list");
  wrapper.append(element("h4", undefined, label));
  if (amounts.length === 0) {
    wrapper.append(element("p", undefined, "None."));
    return wrapper;
  }
  const list = document.createElement("ul");
  for (const amount of amounts) {
    const item = document.createElement("li");
    item.textContent = `${amount.amountDisplay} ${amount.symbol ?? amount.denomination ?? "unspecified asset"} (${amount.amountKind})`;
    list.append(item);
  }
  wrapper.append(list);
  return wrapper;
}

function renderHumanReviewAmountList(label: string, amounts: HumanReviewAmount[]): HTMLElement {
  const wrapper = element("div", "amount-list");
  wrapper.append(element("h4", undefined, label));
  if (amounts.length === 0) {
    wrapper.append(element("p", undefined, "None."));
    return wrapper;
  }
  const list = document.createElement("ul");
  for (const amount of amounts) {
    const displayPrefix = amount.displayAmount ? `${amount.displayAmount} ${amount.symbol}; ` : "";
    const item = document.createElement("li");
    item.textContent =
      `${amount.role}: ${displayPrefix}${amount.rawAmount} raw ${amount.symbol} (${amount.coinType}, decimals ${amount.decimals}; source ${amount.rawAmountSource})`;
    list.append(item);
  }
  wrapper.append(list);
  return wrapper;
}

function renderFactList(label: string, facts: string[]): HTMLElement {
  const wrapper = element("div", "fact-list");
  wrapper.append(element("h4", undefined, label));
  if (facts.length === 0) {
    wrapper.append(element("p", undefined, "None."));
    return wrapper;
  }
  const list = document.createElement("ul");
  for (const fact of facts) {
    const item = document.createElement("li");
    item.textContent = fact;
    list.append(item);
  }
  wrapper.append(list);
  return wrapper;
}

function renderChecks(label: string, checks: GuardianCheck[]): HTMLElement {
  const wrapper = element("div", "checks");
  if (label) {
    wrapper.append(element("h4", undefined, label));
  }
  if (checks.length === 0) {
    wrapper.append(element("p", undefined, "No checks recorded."));
    return wrapper;
  }
  const list = document.createElement("ul");
  for (const check of checks) {
    const item = document.createElement("li");
    item.className = `check ${check.status}`;
    item.append(element("strong", undefined, `${check.label}: ${check.status}`));
    item.append(element("span", undefined, ` ${check.message}`));
    item.append(element("small", undefined, ` Source: ${check.source}; id: ${check.id}`));
    list.append(item);
  }
  wrapper.append(list);
  return wrapper;
}

function partyText(party: ProposalParty): string {
  return [party.label, party.address].filter(Boolean).join(" / ");
}

function targetText(target: string | Record<string, string>): string {
  if (typeof target === "string") {
    return target;
  }
  return Object.entries(target)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}

// The review page's loading-lock over the shared button atom: every button
// disables while an async action (review, sign, reload) is in flight.
function button(label: string, onClick: () => void, variant: "primary" | "secondary" = "primary"): HTMLButtonElement {
  const node = uiButton(label, onClick, variant);
  node.disabled = loading;
  return node;
}

// A review action (Start / Refresh / Run again) with its feedback right beside the button:
// a "running" line while the request is in flight, an inline error on failure (never the
// top toast), and - when the failure is terminal (the session is gone, HTTP 410) - the
// button disabled with a clear "reopen" note so the user is not stuck retrying.
function reviewActionBlock(label: string): HTMLElement {
  const actions = element("div", "actions");
  if (loading) {
    actions.append(note("Running the review…"));
    return actions;
  }
  const run = button(label, () => void runAccountBoundReview(), "primary");
  run.disabled = reviewActionError?.terminal ?? false;
  actions.append(endRow(run));
  if (reviewActionError) {
    actions.append(feedback("error", reviewActionError.message));
    if (reviewActionError.terminal) {
      actions.append(
        element("p", "boundary-note", "This review session expired - reopen the review from your AI client to continue.")
      );
    }
  }
  return actions;
}
