import { workflowViewSchema, type WorkflowView } from "../../core/session/workflowView.js";
import { card, element, row, accordion } from "../../../review-app/src/ui/ui.js";
import { rawToDisplay, signedRawToDisplay, suiAmount } from "../../../review-app/src/format.js";
import { gasRows, chainReceiptView } from "../../../review-app/src/ui/chainReceiptView.js";
import { ptbGraphCard, disposePtbGraphs } from "../../../review-app/src/ui/ptbDiagram.js";
import { receiptForCard } from "./receiptData.js";
import type { CardSnapshot, CardReceiptDisplay } from "../contracts.js";
import type { CardRenderer } from "./lifecycle.js";
import "../../../review-app/src/receipt.css";
import "./workflow.css";

function reviewView(snapshot: CardSnapshot, display?: CardReceiptDisplay, act?: (input: Record<string, unknown>) => void) {
  const data = workflowViewSchema.parse(snapshot.data), review = data.review;
  if (!review) throw new Error("Review data is unavailable.");
  const node = element("div", "workflow-card");
  try {
    const plan = review.plan, state = review.state, human = state?.humanReadableReview;
    const primary = card(human?.proposedAction.title ?? plan.title);
    primary.append(element("p", undefined, human?.proposedAction.summary ?? plan.summary));
    if (data.walletAvailability.status === "unavailable") primary.append(element("p", "ui-note", data.walletAvailability.message));
    primary.append(row("Status", data.request?.requestStatus ?? (review.preparing ? "Updating review…" : review.status)));
    primary.append(row("Review revision", String(review.reviewRevision)), row("Network", "Sui mainnet"));
    if (review.error) primary.append(element("p", "ui-note", review.error));
    if (review.account) primary.append(row("Reviewed account", review.account));
    if (human) {
      for (const amount of human.assetFlow.outgoing) primary.append(row("You send, up to", `${rawToDisplay(amount.rawAmount, amount.decimals)} ${amount.symbol}`));
      for (const amount of human.assetFlow.expectedIncoming) primary.append(row("Expected receive", `${rawToDisplay(amount.rawAmount, amount.decimals)} ${amount.symbol}`));
      for (const amount of human.assetFlow.minimumIncoming) primary.append(row("Minimum receive if execution succeeds", `${rawToDisplay(amount.rawAmount, amount.decimals)} ${amount.symbol}`));
      for (const amount of human.assetFlow.fees) primary.append(row("Protocol fee", `${rawToDisplay(amount.rawAmount, amount.decimals)} ${amount.symbol}`));
      for (const recipient of human.recipients) primary.append(row(recipient.role === "output_recipient" ? "Receiving account" : "Account", recipient.address));
      primary.append(row("Checked at", human.freshness.evaluatedAt), row("Review expires", human.freshness.expiresAt));
    } else {
      for (const amount of plan.assetFlowPreview.outgoing) primary.append(row("Proposed send (display input)", `${amount.amount} ${amount.symbol}`));
      for (const amount of plan.assetFlowPreview.expectedIncoming) primary.append(row("Proposed receive (display input)", `${amount.amount} ${amount.symbol}`));
    }
    primary.append(row("Protocol", plan.protocol));
    if (data.netGasMist !== undefined) primary.append(row("Estimated net network fee", suiAmount(data.netGasMist)));
    const gasBudget = state?.transactionReviewData?.gas.gasBudgetRaw;
    if (gasBudget !== undefined) primary.append(row("Maximum gas budget", suiAmount(gasBudget)));
    for (const check of (state?.checks ?? plan.preliminaryChecks ?? []).filter((check) => check.status !== "pass")) {
      primary.append(element("p", check.status === "fail" ? "ui-error" : "ui-note", `${check.label}: ${check.message}`));
    }
    node.append(primary);
    if (plan.reviewModel) {
      const proposal = plan.reviewModel, facts = card("External proposal — not signable");
      facts.append(row("Source", proposal.proposalSource.name), element("p", "ui-note", proposal.nonSignableReason.message));
      for (const group of [proposal.evidenceUsed, proposal.missingEvidence, proposal.requiredUserChoices, proposal.unsupportedClaims]) {
        for (const item of group) facts.append(row(item.label, "summary" in item ? item.summary : item.reason));
      }
      for (const recipient of proposal.recipients) facts.append(row("Proposed recipient", recipient.address ?? recipient.label ?? "Not specified"));
      const details = accordion("Proposal facts"); details.body.append(element("pre", "workflow-record", JSON.stringify(proposal, null, 2)));
      facts.append(details.details); node.append(facts);
      if (data.allowedActions.includes("cancel")) primary.append(actionButton("Cancel this selection", { action: "cancel" }, act));
    } else if (data.mode !== "review_manage") appendReviewActions(primary, data, act);

    if (data.request) {
      const request = data.request, result = card("Transaction request");
      result.append(row("Request", request.attemptId), row("Request status", request.requestStatus),
        row("Transaction digest", request.transactionDigest), row("Updated", request.updatedAt));
      if (request.reason) result.append(element("p", "ui-note", request.reason));
      if (data.observe && request.requestStatus === "outcome_unknown") result.append(element("p", "ui-note", "Checking the same transaction digest on Sui…"));
      if (!request.execution) result.append(element("p", "ui-note", "No chain execution result has been confirmed. Request closure does not prove that the transaction did not execute."));
      if (data.allowedActions.includes("stop_waiting")) result.append(actionButton("Stop waiting", { action: "stop_waiting" }, act));
      if (data.allowedActions.includes("read_result")) result.append(actionButton("Read this transaction's result", { action: "read_result" }, act));
      node.append(result);
      if (request.execution) {
        if (data.receipt && typeof data.receipt === "object" && "status" in data.receipt && data.receipt.status === "found") {
          const receipt = chainReceiptView(receiptForCard(snapshot, display));
          if (!display) receipt.prepend(element("p", "ui-note", "Input values and PTB details are unavailable; this does not mean the transaction had no inputs."));
          node.append(receipt);
        } else {
          const facts = card("Observed chain result"), receipt = request.execution.chainReceipt;
          facts.append(row("Result", request.execution.status), row("Sender", receipt.sender), row("Checked at", receipt.source.fetchedAt));
          for (const balance of receipt.accountBalanceChanges) facts.append(row(balance.coinType, `${balance.amountRaw} raw units`));
          for (const call of receipt.packageCalls) facts.append(row("Package call", call.target));
          facts.append(element("p", "ui-note", "Additional gas, input and event details are unavailable. The verified chain facts above are retained."));
          node.append(facts);
        }
      }
    }
    if (state) {
      const details = card("Transaction details"), gas = state.simulation?.gasCostSummary;
      const funding = human?.evidenceUsed.find((fact) => fact.id === "transaction_funding");
      if (funding) details.append(row(funding.label, funding.summary));
      if (gas && data.netGasMist !== undefined) for (const item of gasRows({ totalMist: data.netGasMist,
        computationMist: gas.computationCostRaw, storageMist: gas.storageCostRaw, storageRebateMist: gas.storageRebateRaw })) details.append(item);
      for (const change of state.simulation?.balanceChanges ?? []) {
        const amount = human ? [...human.assetFlow.outgoing, ...human.assetFlow.expectedIncoming, ...human.assetFlow.fees].find((item) => item.coinType === change.coinType) : undefined;
        details.append(row(`Estimated balance change · ${change.address}`, amount ? `${signedRawToDisplay(change.amount, amount.decimals)} ${amount.symbol}` : `${change.amount} raw units · ${change.coinType}`));
      }
      const ptb = state.ptbVisualization;
      if (ptb) {
        details.append(ptbGraphCard({ source: "review", mermaid: ptb.mermaid }));
        if (ptb.generatedAt) details.append(row("Graph generated", ptb.generatedAt));
        const evidence = accordion("Graph source and diagnostics"); evidence.body.append(element("pre", "workflow-record", JSON.stringify(ptb, null, 2))); details.append(evidence.details);
      }
      node.append(details);
    }
    const audit = card("Review record"), checks = accordion("Checks and source evidence");
    checks.body.append(element("pre", "workflow-record", JSON.stringify({ reviewSessionId: review.reviewSessionId,
      reviewRevision: review.reviewRevision, checks: state?.checks ?? plan.preliminaryChecks,
      sourceReferences: state?.transactionReviewData?.sourceReferences,
      evidenceUsed: human?.evidenceUsed, missingEvidence: human?.missingEvidence,
      requiredUserChoices: human?.requiredUserChoices, unsupportedClaims: human?.unsupportedClaims }, null, 2)));
    audit.append(checks.details); node.append(audit, element("p", "ui-note", data.boundary));
    return { node, dispose: () => disposePtbGraphs(node) };
  } catch (error) { disposePtbGraphs(node); throw error; }
}

function actionButton(label: string, input: Record<string, unknown>, act?: (input: Record<string, unknown>) => void): HTMLButtonElement {
  const button = document.createElement("button"); button.type = "button"; button.textContent = label;
  button.dataset.cardAction = String(input.action); button.disabled = !act;
  button.addEventListener("click", () => act?.(input)); return button;
}
function appendReviewActions(node: HTMLElement, data: WorkflowView, act?: (input: Record<string, unknown>) => void): void {
  const review = data.review!;
  if (data.allowedActions.includes("prepare_review")) {
    const choices = data.connections.filter((connection) => connection.status === "connected" && connection.pendingAction === undefined)
      .flatMap((connection) => connection.accounts.filter((account) => account === data.activeAccount).map((account) => ({ connection, account })));
    if (choices.length) {
      const form = document.createElement("form"), select = document.createElement("select");
      select.className = "workflow-select"; select.required = true; select.setAttribute("aria-label", "Wallet connection for this review");
      const empty = document.createElement("option"); empty.value = ""; empty.textContent = "Select the wallet for this account"; select.append(empty);
      for (const { connection, account } of choices) {
        const option = document.createElement("option"); option.value = connection.connectionId; option.textContent = `${connection.walletName ?? "Wallet"} · ${account}`; select.append(option);
      }
      const submit = document.createElement("button"); submit.type = "submit"; submit.dataset.cardAction = "prepare_review";
      submit.textContent = review.state ? "Update this review" : "Review selected account"; form.append(select, submit);
      form.addEventListener("submit", (event) => { event.preventDefault(); const choice = choices.find((item) => item.connection.connectionId === select.value);
        if (choice) act?.({ action: "prepare_review", connectionId: choice.connection.connectionId, account: choice.account, reviewRevision: review.reviewRevision }); });
      node.append(form);
    } else node.append(element("p", "ui-note", "Connect a Sui wallet and explicitly select its account for reads before updating this review."));
  }
  if (data.allowedActions.includes("request_signature") && review.account) {
    const choices = data.connections.filter((connection) => connection.status === "connected" && connection.pendingAction === undefined && connection.accounts.includes(review.account!) && connection.methods.includes("sui_signTransaction"));
    const form = document.createElement("form"), select = document.createElement("select");
    select.className = "workflow-select"; select.required = true; select.setAttribute("aria-label", "Wallet to approve this transaction");
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = "Choose the signing wallet"; select.append(empty);
    for (const connection of choices) { const option = document.createElement("option"); option.value = connection.connectionId; option.textContent = connection.walletName ?? connection.connectionId; select.append(option); }
    const submit = document.createElement("button"); submit.type = "submit"; submit.dataset.cardAction = "request_signature"; submit.textContent = "Request wallet approval";
    form.append(select, submit); form.addEventListener("submit", (event) => { event.preventDefault();
      if (choices.some((item) => item.connectionId === select.value)) act?.({ action: "request_signature", connectionId: select.value, account: review.account!, reviewRevision: review.reviewRevision }); }); node.append(form);
  }
  if (data.allowedActions.includes("cancel")) node.append(actionButton("Cancel this selection", { action: "cancel" }, act));
}

export const reviewRenderer = {
  title: "Review transaction",
  controls: (snapshot, act, display) => reviewView(snapshot, display, act),
  result: (snapshot, display, act) => reviewView(snapshot, display, act)
} satisfies CardRenderer;
