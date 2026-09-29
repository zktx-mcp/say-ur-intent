import { workflowViewSchema, type WorkflowView } from "../../core/session/workflowView.js";
import { card, element, row, accordion, button, field, select, mono, timeValue } from "../../../review-app/src/ui/ui.js";
import { rawToDisplay, signedRawToDisplay, suiAmount } from "../../../review-app/src/format.js";
import { gasRows, chainReceiptDetails } from "../../../review-app/src/ui/chainReceiptView.js";
import { receiptSummary } from "../../../review-app/src/ui/receiptSummary.js";
import { ptbGraphCard, disposePtbGraphs } from "../../../review-app/src/ui/ptbDiagram.js";
import { receiptForCard } from "./receiptData.js";
import type { CardSnapshot, CardReceiptDisplay } from "../contracts.js";
import type { CardRenderer } from "./lifecycle.js";
import type { ProposalReviewModel } from "../../core/proposal/types.js";
import "./workflow.css";

// Labels describe backend facts; they never grant an action or infer an outcome.
const reviewLabels: Record<NonNullable<WorkflowView["review"]>["status"], string> = {
  proposed: "Review not prepared", awaiting_wallet: "Wallet connection needed",
  wallet_connected: "Review not prepared", ready_for_wallet_review: "Ready for wallet review",
  refresh_required: "Refresh required", blocked: "Review blocked", expired: "Review expired"
};
const requestLabels: Record<NonNullable<WorkflowView["request"]>["requestStatus"], string> = {
  awaiting_signature: "Waiting for wallet approval", submitting: "Submitting transaction",
  awaiting_chain_result: "Waiting for a chain result", stopped: "Local waiting stopped",
  request_failed: "Wallet request ended", outcome_unknown: "Chain result not confirmed", completed: "Chain result verified"
};
type Review = NonNullable<WorkflowView["review"]>;

function proposalFacts(proposal: ProposalReviewModel, checks: NonNullable<Review["plan"]["preliminaryChecks"]>): HTMLElement {
  const node = card("External proposal — not signable");
  node.append(element("p", undefined, proposal.proposedAction.title));
  const sourceKinds: Record<ProposalReviewModel["proposalSource"]["kind"], string> = {
    mcp_server: "MCP server", ai_client: "AI client", user: "User", other: "Other"
  };
  const timingLabels: Record<ProposalReviewModel["freshness"]["status"], string> = {
    current: "Current at evaluation", expired: "Expired at evaluation",
    created_in_future: "Created after evaluation time", expiry_not_provided: "Expiry not provided"
  };
  node.append(element("p", "ui-note", proposal.nonSignableReason.message),
    row("Source", proposal.proposalSource.name), row("Source kind", sourceKinds[proposal.proposalSource.kind]),
    row("Action", proposal.proposedAction.kind === "payment" ? "Payment" : "Sui action"),
    row("Purpose", proposal.proposedAction.purpose), row("Declared network", proposal.proposedAction.network));
  for (const recipient of proposal.recipients) {
    const value = element("span");
    if (recipient.label) value.append(element("span", undefined, `${recipient.label}${recipient.address ? " · " : ""}`));
    if (recipient.address) value.append(mono(recipient.address));
    node.append(row("Proposed recipient", value));
  }
  for (const target of proposal.targets) {
    if (typeof target === "string") { node.append(row("Proposed target", target)); continue; }
    node.append(row("Proposed target", target.label ?? "Sui action target"));
    const detail = accordion("Target details");
    for (const [key, label] of [["packageId", "Package"], ["module", "Module"], ["function", "Function"], ["objectId", "Object"]] as const) {
      if (target[key]) detail.body.append(row(label, mono(target[key])));
    }
    if (detail.body.children.length) node.append(detail.details);
  }
  // Declared strings are displayed without token conversion, aggregation or
  // promotion to verified transaction amounts. This replaces generic preview rows.
  for (const [direction, label] of [["outgoing", "Proposed send"], ["expectedIncoming", "Proposed receive"], ["fees", "Proposed fee"]] as const) {
    for (const amount of proposal.assetFlow[direction]) {
      const item = element("div");
      item.append(row(label, `${amount.amountDisplay}${amount.symbol ? ` ${amount.symbol}` : ""}${amount.denomination ? ` (denomination: ${amount.denomination})` : ""}`));
      if (amount.coinType) {
        const detail = accordion("Declared asset"); detail.body.append(row("Declared coin type", mono(amount.coinType))); item.append(detail.details);
      }
      node.append(item);
    }
  }
  node.append(row("Declared timing", timingLabels[proposal.freshness.status]), element("p", "ui-note", proposal.freshness.reason));
  for (const group of [proposal.missingEvidence, proposal.requiredUserChoices, proposal.unsupportedClaims]) {
    for (const item of group) node.append(row(item.label, item.reason));
  }
  const detail = accordion("Proposal details");
  if (proposal.proposalSource.reference) detail.body.append(row("Source reference", proposal.proposalSource.reference));
  detail.body.append(row("Proposal created", timeValue(proposal.freshness.proposalCreatedAt)),
    row("Proposal expires", proposal.freshness.proposalExpiresAt ? timeValue(proposal.freshness.proposalExpiresAt) : "Not provided"),
    row("Evaluated at", timeValue(proposal.freshness.evaluatedAt)));
  const evidence = element("div"); evidence.append(element("h3", "ui-card-head", "Source evidence"));
  for (const fact of proposal.evidenceUsed) evidence.append(row(fact.label, fact.summary));
  const passed = element("div"); passed.append(element("h3", "ui-card-head", "Passed checks"));
  for (const check of checks.filter((item) => item.status === "pass")) passed.append(row(check.label, check.message));
  detail.body.append(evidence);
  if (passed.children.length > 1) detail.body.append(passed);
  node.append(detail.details);
  return node;
}

function reviewedConditions(data: WorkflowView): HTMLElement {
  const review = data.review!, human = review.state?.humanReadableReview, plan = review.plan;
  const node = card(human?.proposedAction.title ?? plan.title);
  node.append(element("p", undefined, human?.proposedAction.summary ?? plan.summary));
  const address = review.account ?? data.activeAccount;
  const receivesHere = human?.recipients.some((item) => item.role === "output_recipient" && item.address === address);
  node.append(row(review.account ? receivesHere ? "Send and receive account" : "Reviewed account" : "Account to review", address ? mono(address) : "Not selected"), row("Network", "Sui mainnet"));
  if (human) {
    for (const amount of human.assetFlow.outgoing) node.append(row("You send, up to", `${rawToDisplay(amount.rawAmount, amount.decimals)} ${amount.symbol}`));
    for (const amount of human.assetFlow.expectedIncoming) node.append(row("Expected receive", `${rawToDisplay(amount.rawAmount, amount.decimals)} ${amount.symbol}`));
    for (const amount of human.assetFlow.minimumIncoming) node.append(row("Minimum receive if execution succeeds", `${rawToDisplay(amount.rawAmount, amount.decimals)} ${amount.symbol}`));
    for (const amount of human.assetFlow.fees) node.append(row("Protocol fee", `${rawToDisplay(amount.rawAmount, amount.decimals)} ${amount.symbol}`));
    for (const recipient of human.recipients.filter((item) => item.address !== address)) node.append(row("Receiving account", mono(recipient.address)));
  } else {
    for (const amount of plan.assetFlowPreview.outgoing) node.append(row("Proposed send (display input)", `${amount.amount} ${amount.symbol}`));
    for (const amount of plan.assetFlowPreview.expectedIncoming) node.append(row("Proposed receive (display input)", `${amount.amount} ${amount.symbol}`));
  }
  node.append(row("Protocol", plan.protocol));
  if (data.netGasMist !== undefined) node.append(row("Estimated net network fee", suiAmount(data.netGasMist)));
  const budget = review.state?.transactionReviewData?.gas.gasBudgetRaw;
  if (budget !== undefined) node.append(row("Maximum gas budget", suiAmount(budget)));
  if (human) node.append(row("Checked at", timeValue(human.freshness.evaluatedAt)), row("Review expires", timeValue(human.freshness.expiresAt)));
  return node;
}

function reviewDetails(review: Review, historical = false): HTMLElement {
  const node = element("div"), state = review.state, human = state?.humanReadableReview;
  if (!state) return element("p", "ui-note", "This proposal has no account-bound review yet.");
  const gas = state.simulation?.gasCostSummary;
  if (gas) node.append(...gasRows({ computationMist: gas.computationCostRaw, storageMist: gas.storageCostRaw, storageRebateMist: gas.storageRebateRaw }));
  const policy = state.transactionReviewData?.slippageOrMinOut;
  if (policy?.minOutRaw !== undefined) node.append(row("Minimum receive (raw units)", policy.minOutRaw));
  if (policy?.maxSlippageBps !== undefined) node.append(row("Maximum slippage (basis points)", String(policy.maxSlippageBps)));
  if (policy?.policySource) node.append(row("Slippage choice", policy.policySource === "user_explicit" ? "Chosen by you" : "Adapter policy from quote evidence"));
  for (const change of state.simulation?.balanceChanges ?? []) {
    const amount = human && [...human.assetFlow.outgoing, ...human.assetFlow.expectedIncoming, ...human.assetFlow.fees].find((item) => item.coinType === change.coinType);
    node.append(row(`Estimated balance change · ${change.address}`, amount ? `${signedRawToDisplay(change.amount, amount.decimals)} ${amount.symbol}` : `${change.amount} raw units · ${change.coinType}`));
  }
  for (const change of state.simulation?.objectChanges ?? []) node.append(row(`Simulated object · ${change.objectId}`,
    `${change.inputState} → ${change.outputState} · ${change.idOperation}${change.objectType ? ` · ${change.objectType}` : ""}`));
  if (human) {
    const preparation = accordion("Notes from evidence preparation");
    preparation.body.append(element("p", "ui-note", "These notes were recorded at the human-readable evidence stage, before final checks. They describe that earlier stage, not the current transaction outcome."));
    for (const fact of human.evidenceUsed) preparation.body.append(row(fact.label, fact.summary));
    for (const gap of [...human.missingEvidence, ...human.unsupportedClaims]) preparation.body.append(row(gap.label, gap.reason));
    node.append(preparation.details);
  }
  if (historical) for (const gap of human?.requiredUserChoices ?? []) node.append(row(gap.label, gap.reason));
  for (const check of state.checks.filter((item) => historical || item.status === "pass")) node.append(row(check.label, check.message));
  for (const source of state.transactionReviewData?.sourceReferences ?? []) node.append(row(source.source, timeValue(source.verifiedAt)));
  if (state.ptbVisualization) node.append(ptbGraphCard({ source: "review", mermaid: state.ptbVisualization.mermaid }));
  return node;
}

function reviewView(snapshot: CardSnapshot, display?: CardReceiptDisplay, act?: (input: Record<string, unknown>) => void) {
  const data = workflowViewSchema.parse(snapshot.data), review = data.review;
  if (!review) throw new Error("Review data is unavailable.");
  const node = element("div", "workflow-card");
  let disposed = false;
  const action = (input: Record<string, unknown>) => { if (!disposed) act?.(input); };
  const actionButton = (label: string, input: Record<string, unknown>, primary = false) => {
    const control = button(label, () => action(input), primary ? "primary" : "secondary");
    control.dataset.cardAction = String(input.action); control.disabled = !act; return control;
  };
  // A disclosure owns only its DOM. Opening it never calls a service or action.
  const details = (label: string, render: (body: HTMLElement) => void) => {
    const section = accordion(label); let rendered = false;
    section.details.addEventListener("toggle", () => {
      if (disposed || rendered || !section.details.open || !section.details.isConnected) return;
      try { render(section.body); rendered = true; }
      catch { disposePtbGraphs(section.body); section.body.replaceChildren(element("p", "ui-error", "These details could not be displayed. Close and reopen the details to try again.")); }
    });
    return section.details;
  };
  try {
    const request = data.request, execution = request?.execution;
    if (execution) {
      if (data.receipt && typeof data.receipt === "object" && "status" in data.receipt && data.receipt.status === "found") {
        const receipt = receiptForCard(snapshot, display);
        node.append(receiptSummary(receipt), details("Transaction details", (body) => {
          if (!display) body.append(element("p", "ui-note", "Input values and PTB details are unavailable; this does not mean the transaction had no inputs."));
          body.append(chainReceiptDetails(receipt));
        }));
      } else {
        const facts = card(), receipt = execution.chainReceipt;
        const outcome = row("Result", execution.status === "success" ? "Transaction succeeded on Sui" : "Transaction failed on Sui");
        outcome.setAttribute("role", "status");
        facts.append(outcome, row("Sender", mono(receipt.sender)), row("Transaction hash", mono(request.transactionDigest)),
          row("Checked at", timeValue(receipt.source.fetchedAt)), element("p", "ui-note", "Additional amount and fee details are unavailable. The verified result is retained."));
        node.append(facts, details("Transaction details", (body) => {
          for (const change of receipt.accountBalanceChanges) body.append(row(change.coinType, `${change.amountRaw} raw units`));
          for (const call of receipt.packageCalls) body.append(row("Package call", call.target));
        }));
      }
      node.append(details("Reviewed conditions", (body) => { body.append(reviewedConditions(data), reviewDetails(review, true)); }));
    } else {
      const proposal = review.plan.reviewModel;
      const checks = review.state?.checks ?? review.plan.preliminaryChecks ?? [];
      const primary = request ? card(review.state?.humanReadableReview?.proposedAction.title ?? review.plan.title)
        : proposal ? proposalFacts(proposal, checks) : reviewedConditions(data);
      if (request) {
        primary.append(element("p", undefined, review.state?.humanReadableReview?.proposedAction.summary ?? review.plan.summary),
          row("Transaction hash", mono(request.transactionDigest)), row("Updated", timeValue(request.updatedAt)));
      }
      const decision = element("div", "workflow-decision");
      const status = row("Status", request ? requestLabels[request.requestStatus] : review.preparing ? "Updating review…" : reviewLabels[review.status]);
      status.setAttribute("role", "status"); decision.append(status);
      if (data.walletAvailability.status === "unavailable") decision.append(element("p", "ui-note", data.walletAvailability.message));
      if (!request && review.error) decision.append(element("p", "ui-note", review.error));
      if (request) {
        if (request.reason) decision.append(element("p", "ui-note", request.reason));
        if (["stopped", "request_failed"].includes(request.requestStatus)) decision.append(element("p", "ui-note", "No chain execution result has been confirmed."));
        if (data.observe && request.requestStatus === "outcome_unknown") decision.append(element("p", "ui-note", "Checking this transaction on Sui…"));
        if (data.allowedActions.includes("stop_waiting")) {
          decision.append(actionButton("Stop waiting", { action: "stop_waiting" }));
          decision.append(element("p", "ui-note", request.requestStatus === "awaiting_signature"
            ? "Stopping local waiting removes permission to submit this request."
            : "Stopping result checks does not cancel the transaction."));
        }
        if (data.allowedActions.includes("read_result")) decision.append(actionButton("Read transaction result", { action: "read_result" }));
        if (data.observationStopped) decision.append(element("p", "ui-note", "Automatic checks are stopped. Reading this transaction cannot sign or resubmit it."));
      } else {
        for (const check of checks.filter((item) => item.status !== "pass")) decision.append(element("p", check.status === "fail" ? "ui-error" : "ui-note", `${check.label}: ${check.message}`));
        for (const gap of (review.state?.humanReadableReview?.requiredUserChoices ?? [])) decision.append(row(gap.label, gap.reason));
        if (!review.plan.reviewModel && data.mode !== "review_manage") {
          appendReviewActions(decision, data, act ? action : undefined);
          decision.append(element("p", "ui-note", "To change the amount, assets or slippage, ask for a new review in chat."));
        }
        if (proposal && data.allowedActions.includes("cancel")) decision.append(actionButton("Close", { action: "cancel" }));
      }
      primary.append(decision); node.append(primary);
      if (request) node.append(details("Reviewed conditions", (body) => { body.append(reviewedConditions(data), reviewDetails(review, true)); }));
      else if (review.state && !proposal) node.append(details("Review details", (body) => body.append(reviewDetails(review))));
    }
    node.append(element("p", "ui-note", data.boundary));
    return { node, dispose: () => { disposed = true; disposePtbGraphs(node); } };
  } catch (error) { disposed = true; disposePtbGraphs(node); throw error; }
}

function appendReviewActions(node: HTMLElement, data: WorkflowView, act?: (input: Record<string, unknown>) => void): void {
  const review = data.review!;
  const shownWallets = new Set<string>();
  const choose = (action: "prepare_review" | "request_signature", label: string, account: string, choices: WorkflowView["connections"], primary: boolean) => {
    const send = (connectionId: string) => act?.({ action, connectionId, account, reviewRevision: review.reviewRevision });
    const control = button(label, () => { if (choices.length === 1) send(choices[0]!.connectionId); }, primary ? "primary" : "secondary");
    control.dataset.cardAction = action; control.disabled = !act;
    if (choices.length === 1) {
      // The displayed target and this explicit click form the selection. No action
      // runs merely because this is the only candidate or the frame was recreated.
      if (!shownWallets.has(choices[0]!.connectionId)) {
        node.append(row("Wallet", choices[0]!.walletName ?? "Connected wallet")); shownWallets.add(choices[0]!.connectionId);
      }
      node.append(control);
      return;
    }
    const form = document.createElement("form"); form.className = "ui-form";
    const choice = select({ choices: [{ value: "", label: "Choose a wallet" }, ...choices.map((item) => ({ value: item.connectionId, label: item.walletName ?? item.connectionId }))] });
    choice.required = true; choice.setAttribute("aria-label", action === "prepare_review" ? "Wallet connection for this review" : "Wallet to approve this transaction");
    control.type = "submit"; form.append(field("Wallet", choice), control);
    form.addEventListener("submit", (event) => { event.preventDefault(); if (choices.some((item) => item.connectionId === choice.value)) send(choice.value); });
    node.append(form);
  };
  const canSign = data.allowedActions.includes("request_signature") && !!review.account && data.walletAvailability.status === "available";
  const canPrepare = data.allowedActions.includes("prepare_review") && !!data.activeAccount && data.walletAvailability.status === "available";
  const signingChoices = canSign ? data.connections.filter((item) => item.status === "connected" && !item.pendingAction && item.accounts.includes(review.account!) && item.methods.includes("sui_signTransaction")) : [];
  const preparationChoices = canPrepare ? data.connections.filter((item) => item.status === "connected" && !item.pendingAction && item.accounts.includes(data.activeAccount!)) : [];
  if (canSign && canPrepare && review.account === data.activeAccount && !signingChoices.length && !preparationChoices.length) {
    node.append(element("p", "ui-note", "No wallet connection is available for this account."));
  } else {
    if (canSign && !signingChoices.length) node.append(element("p", "ui-note", "No wallet connection can approve this transaction."));
    if (canPrepare && !preparationChoices.length) node.append(element("p", "ui-note", "No wallet connection is available to update the review for the selected account."));
  }
  if (signingChoices.length) choose("request_signature", "Request wallet approval", review.account!, signingChoices, true);
  if (preparationChoices.length) choose("prepare_review", review.state ? "Update review" : "Review transaction", data.activeAccount!, preparationChoices, !signingChoices.length);
  if (data.allowedActions.includes("cancel")) {
    const cancel = button("Close", () => act?.({ action: "cancel" }), "secondary"); cancel.dataset.cardAction = "cancel"; cancel.disabled = !act; node.append(cancel);
  }
}

export const reviewRenderer = {
  title: "Review transaction",
  controls: (snapshot, act, display) => reviewView(snapshot, display, act),
  result: (snapshot, display, act) => reviewView(snapshot, display, act)
} satisfies CardRenderer;
