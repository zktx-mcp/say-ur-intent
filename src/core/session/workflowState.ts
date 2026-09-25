import type { ReviewSession } from "../action/types.js";
import type { z } from "zod";
import type { reviewStateOutputSchema } from "../action/schemas.js";
import type { CardRecord, ReceiptDisplay } from "./cardSession.js";
import type { WalletAvailability, WalletConnection } from "./walletConnection.js";
import { isInitialChainObservation, type TransactionRequest } from "./transactionRequest.js";
import type { RequestAuthority } from "./sqliteWalletWorkflowStore.js";
import type { ReviewEvaluationCandidate } from "./reviewValidity.js";
import type { EventLogRecord } from "../eventlog/sink.js";

export const workflowActions = ["connect", "disconnect", "use_account", "stop_connection", "prepare_review",
  "request_signature", "cancel", "stop_waiting", "read_result"] as const;
export type WorkflowAction = (typeof workflowActions)[number];
export type ConnectionView = WalletConnection & { pendingAction?: "disconnect" };
// Read context may change; an existing review's account binding may not.
// Both evaluated choices and admission consume this relation with current facts.
export function reviewPreparationAccount(boundAccount: string | undefined, activeAccount: string | undefined, selectedAccount = activeAccount):
  { allowed: true; account: string } | { allowed: false; message: string } {
  if (!activeAccount) return { allowed: false, message: "Select an approved wallet account as the read account before preparing this review." };
  if (boundAccount && boundAccount !== activeAccount) return { allowed: false,
    message: `This review is bound to ${boundAccount}. Select that account as the read account again, or request a new review for ${activeAccount}.` };
  if (selectedAccount !== activeAccount) return { allowed: false,
    message: "The selected account is no longer the read account. Read the current card before preparing this review." };
  return { allowed: true, account: activeAccount };
}
export type WorkflowEligibilityFacts = {
  evaluatedAt: string; ownerId: string; record?: CardRecord | undefined;
  walletAvailability: WalletAvailability; activeAccount?: string | undefined;
  connection?: ConnectionView | undefined;
  session?: ReviewSession | undefined; request?: TransactionRequest | undefined;
  authority?: RequestAuthority | undefined; busyForAccount: boolean;
};
export type WorkflowFacts = WorkflowEligibilityFacts & {
  hasReviewInput: boolean;
  connections: ConnectionView[]; boundReview?: z.infer<typeof reviewStateOutputSchema> | undefined;
  receipt?: unknown; receiptDisplay?: ReceiptDisplay | undefined;
};
export type EvaluatedWorkflowState = WorkflowFacts & {
  allowedActions: WorkflowAction[]; actionRemainingMs: number; inputRemainingMs: number;
  nextStateReadAfterMs?: number | undefined; events: EventLogRecord[];
  preparationIssue?: string | undefined;
};
export type WorkflowEvaluationInput = {
  expectedCard?: CardRecord | undefined; reviewSessionId?: string | undefined;
  candidate?: ReviewEvaluationCandidate | undefined; walletAvailability: WalletAvailability;
  uiObservation?: boolean | undefined;
};

// Shared domain eligibility. The DB supplies current facts at its decision
// boundary. Returned choices are advisory; admission still binds concrete input.
export function workflowEligibility(facts: WorkflowEligibilityFacts) {
  const { record, session, request, authority, walletAvailability } = facts;
  const at = Date.parse(facts.evaluatedAt);
  const remaining = record?.ownerId === facts.ownerId ? Math.max(0, Date.parse(record.state.expiresAt) - at) : 0;
  const inputAvailable = remaining > 0 && record?.state.state === "ready" && record.acceptedInput === undefined;
  const allowedActions: WorkflowAction[] = [];
  let preparationIssue: string | undefined;
  if (record?.scope === "connect") {
    if (inputAvailable) {
      allowedActions.push("cancel");
      if (walletAvailability.status === "available") allowedActions.push("connect", "disconnect", "use_account");
    }
    if (remaining > 0 && facts.connection?.status === "awaiting_approval") allowedActions.push("stop_connection");
  }
  if (session && inputAvailable && record?.scope === "review" && session.status !== "expired" && Date.parse(session.expiresAt) > at && !session.preparationId) {
    allowedActions.push("cancel");
    if (walletAvailability.status === "available" && !session.plans[0]?.reviewModel) {
      if (!facts.busyForAccount) {
        const selection = reviewPreparationAccount(session.account, facts.activeAccount);
        if (selection.allowed) allowedActions.push("prepare_review");
        else preparationIssue = selection.message;
      }
      if (session.status === "ready_for_wallet_review" && session.reviewState?.transactionReviewData &&
          (!request || request.reviewRevision !== session.reviewRevision && !facts.busyForAccount)) allowedActions.push("request_signature");
    }
  }
  if (record && session && remaining > 0 && request && request.reviewSessionId === session.id &&
      authority?.owner_id === facts.ownerId &&
      (record.operationId === request.attemptId || record.scope === "review_manage" && record.state.input.attemptId === request.attemptId)) {
    if (["awaiting_signature", "submitting", "awaiting_chain_result"].includes(request.requestStatus)) allowedActions.push("stop_waiting");
    if (isInitialChainObservation(request.requestStatus) || request.requestStatus === "outcome_unknown") allowedActions.push("read_result");
  }
  const expiry = session && inputAvailable && record?.scope === "review" && !session.preparationId &&
    session.status === "ready_for_wallet_review" && (!request || request.reviewRevision !== session.reviewRevision)
      ? session.reviewState?.humanReadableReview?.freshness.expiresAt : undefined;
  const nextRead = expiry && session ? Math.min(remaining, Date.parse(session.expiresAt) - at, Date.parse(expiry) - at) : undefined;
  return { allowedActions, preparationIssue, actionRemainingMs: remaining, inputRemainingMs: inputAvailable ? remaining : 0,
    ...(nextRead !== undefined && nextRead > 0 ? { nextStateReadAfterMs: nextRead } : {}) };
}
