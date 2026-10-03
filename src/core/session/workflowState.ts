import type { ReviewSession } from "../action/types.js";
import type { z } from "zod";
import type { reviewStateOutputSchema } from "../action/schemas.js";
import type { CardRecord, ReceiptDisplay } from "./cardSession.js";
import { walletConnectionSelection, type WalletAvailability, type ConnectionView, type ConnectionConflict, type AssetReadAccount } from "./walletConnection.js";
import { isInitialChainObservation, type TransactionRequest } from "./transactionRequest.js";
import type { RequestAuthority } from "./sqliteWalletWorkflowStore.js";
import type { ReviewEvaluationCandidate } from "./reviewValidity.js";
import type { EventLogRecord } from "../eventlog/sink.js";
import type { WalletRecovery, WalletObservation } from "./walletRuntime.js";

export const workflowActions = ["connect", "disconnect", "use_account", "stop_connection", "prepare_review",
  "request_signature", "cancel", "stop_waiting", "read_result"] as const;
export type WorkflowAction = (typeof workflowActions)[number];
export type { ConnectionView } from "./walletConnection.js";
// Read context may change; an existing review's account binding may not.
// Both evaluated choices and admission consume this relation with current facts.
export function reviewPreparationAccount(boundAccount: string | undefined, activeAccount: string | undefined, selectedAccount = activeAccount):
  { allowed: true; account: string } | { allowed: false; message: string } {
  if (!activeAccount) return { allowed: false, message: "No account from a connected wallet is selected for this review." };
  if (boundAccount && boundAccount !== activeAccount) return { allowed: false,
    message: `This review uses ${boundAccount}, but the currently selected account is ${activeAccount}.` };
  if (selectedAccount !== activeAccount) return { allowed: false,
    message: "The selected account has changed since this request was made." };
  return { allowed: true, account: activeAccount };
}
export type WorkflowEligibilityFacts = {
  evaluatedAt: string; ownerId: string; record?: CardRecord | undefined;
  walletAvailability: Pick<WalletAvailability, "status">; activeAccount?: string | undefined;
  activeAccountConnectionId?: string | undefined;
  walletDependent?: boolean | undefined;
  connection?: ConnectionView | undefined;
  connections: ConnectionView[];
  session?: ReviewSession | undefined; request?: TransactionRequest | undefined;
  authority?: RequestAuthority | undefined; busyForAccount: boolean;
};
export type WorkflowFacts = WorkflowEligibilityFacts & {
  walletAvailability: WalletAvailability;
  walletObservation?: WalletObservation | undefined;
  runtimeRecovery?: WalletRecovery | undefined;
  connectionConflict?: ConnectionConflict | undefined;
  hasReviewInput: boolean;
  boundReview?: z.infer<typeof reviewStateOutputSchema> | undefined;
  receipt?: unknown; receiptDisplay?: ReceiptDisplay | undefined;
};
export type EvaluatedWorkflowState = WorkflowFacts & {
  allowedActions: WorkflowAction[]; actionRemainingMs: number; inputRemainingMs: number;
  usableConnectionId?: string | undefined; assetReadAccount?: AssetReadAccount | undefined;
  nextStateReadAfterMs?: number | undefined; events: EventLogRecord[];
  preparationIssue?: string | undefined;
};
export type WorkflowEvaluationInput = {
  expectedCard?: CardRecord | undefined; reviewSessionId?: string | undefined;
  readTarget?: ReviewReadTarget | undefined;
  candidate?: ReviewEvaluationCandidate | undefined; walletAvailability: WalletAvailability;
  walletObservation?: WalletObservation | undefined;
  uiObservation?: boolean | undefined;
};
// Bound before asynchronous inspection and checked again in the DB transaction.
// A live input needs current wallet eligibility even when an older attempt exists.
export type ReviewReadTarget = {
  reviewSessionId: string; attemptId?: string | undefined; walletDependent: boolean;
};

// Shared domain eligibility. The DB supplies current facts at its decision
// boundary. Returned choices are advisory; admission still binds concrete input.
export function workflowEligibility(facts: WorkflowEligibilityFacts) {
  const { record, session, request, authority, walletAvailability } = facts;
  const at = Date.parse(facts.evaluatedAt);
  const cardRemaining = record?.ownerId === facts.ownerId ? Math.max(0, Date.parse(record.state.expiresAt) - at) : 0;
  // A later-created input card cannot extend its review session. Admitted
  // requests and management cards retain their separate observation authority.
  const remaining = record?.scope === "review" && session && !request
    ? Math.min(cardRemaining, Math.max(0, Date.parse(session.expiresAt) - at)) : cardRemaining;
  const inputAvailable = remaining > 0 && record?.state.state === "ready" && record.acceptedInput === undefined;
  const allowedActions: WorkflowAction[] = [];
  const selection = walletConnectionSelection(facts.connections, at, facts.activeAccount
    ? { address: facts.activeAccount, walletId: facts.activeAccountConnectionId } : undefined);
  const usableConnectionId = walletAvailability.status === "available" && facts.walletDependent !== false
    ? selection.connection?.connectionId : undefined;
  const assetReadAccount: AssetReadAccount | undefined = facts.walletDependent === false ? undefined
    : usableConnectionId ? selection.assetReadAccount : { status: "address_required" };
  let preparationIssue: string | undefined;
  if (record?.scope === "connect") {
    if (inputAvailable) {
      allowedActions.push("cancel");
      if (walletAvailability.status === "available") {
        if (["connect", "manage"].includes(String(record.state.input.intent)) && selection.pairingAllowed) allowedActions.push("connect");
        if (facts.connections.some((item) => item.status === "connected" && !item.pendingAction)) allowedActions.push("disconnect");
        if (selection.connection) allowedActions.push("use_account");
      }
    }
    if (remaining > 0 && facts.connection?.status === "awaiting_approval") allowedActions.push("stop_connection");
  }
  if (session && inputAvailable && record?.scope === "review" && session.status !== "expired" && Date.parse(session.expiresAt) > at && !session.preparationId) {
    allowedActions.push("cancel");
    if (walletAvailability.status === "available" && selection.connection && !session.plans[0]?.reviewModel) {
      const account = reviewPreparationAccount(session.account, assetReadAccount?.status === "available" ? assetReadAccount.account : undefined);
      if (!account.allowed) preparationIssue = account.message;
      else if (!facts.busyForAccount) allowedActions.push("prepare_review");
      if (!facts.busyForAccount && session.status === "ready_for_wallet_review" && session.reviewState?.transactionReviewData &&
          (!request || request.reviewRevision !== session.reviewRevision)) allowedActions.push("request_signature");
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
  return { allowedActions, preparationIssue, usableConnectionId, assetReadAccount, connectionConflict: selection.conflict,
    actionRemainingMs: remaining, inputRemainingMs: inputAvailable ? remaining : 0,
    ...(nextRead !== undefined && nextRead > 0 ? { nextStateReadAfterMs: nextRead } : {}) };
}
