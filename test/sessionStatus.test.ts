import { describe, expect, it } from "vitest";
import type { ReviewSession } from "../src/core/action/types.js";
import type { TransactionRequest } from "../src/core/session/transactionRequest.js";
import { getExecutionPollingStatus, isFinalSessionStatus, executionStatusCategory,
  isWaitStoppingExecutionStatus, isInteractionPendingReviewStatus, reviewStatusResponse, reviewProgress } from "../src/core/session/status.js";
import { chainReceiptDigest, chainReceiptFixture } from "./fixtures/chainReceipt.js";

const review: ReviewSession = { id: "review", ownerId: "owner", reviewRevision: 1, tokenHash: "private",
  status: "ready_for_wallet_review", plans: [], createdAt: new Date(0).toISOString(), expiresAt: new Date(1000).toISOString(), lastActivityAt: new Date(0).toISOString() };
const request: TransactionRequest = { attemptId: "attempt", reviewSessionId: "review", planId: "plan", reviewRevision: 1,
  account: `0x${"a".repeat(64)}`, transactionDigest: chainReceiptDigest, requestStatus: "awaiting_signature", revision: 0,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };

describe("separate preparation, request and chain status", () => {
  it.each(["proposed", "awaiting_wallet", "wallet_connected", "ready_for_wallet_review", "blocked", "refresh_required"] as const)("never calls %s a signing request", (status) => {
    expect(getExecutionPollingStatus({ ...review, status })).toBe(status);
    expect(executionStatusCategory(status)).toBe("user_action_required");
    expect(isFinalSessionStatus(status)).toBe(false);
    expect(isWaitStoppingExecutionStatus(status)).toBe(true);
    expect(isInteractionPendingReviewStatus(status)).toBe(true);
  });
  it.each(["awaiting_signature", "submitting", "awaiting_chain_result", "stopped", "request_failed", "outcome_unknown"] as const)("exposes %s without fabricating execution", (status) => {
    const response = reviewStatusResponse({ session: review, hasReviewInput: false, request: { ...request, requestStatus: status }, walletAvailability: { status: "available", walletRunId: "00000000-0000-4000-8000-000000000001" }, progress: { status: "idle" } });
    expect(response.status).toBe("ready_for_wallet_review"); expect(response.requestStatus).toBe(status);
    expect(response.pollingStatus).toBe(status); expect(response.executionResult).toBeUndefined();
    expect(response).not.toHaveProperty("tokenHash"); expect(response).not.toHaveProperty("ownerId");
  });
  it("preserves completed chain facts independently of later review expiry", () => {
    const execution = { reviewSessionId: "review", attemptId: "attempt", planId: "plan", status: "success" as const,
      txDigest: chainReceiptDigest, chainReceipt: chainReceiptFixture(), recordedAt: new Date(1).toISOString() };
    const response = reviewStatusResponse({ session: { ...review, status: "expired" }, hasReviewInput: false, request: { ...request, requestStatus: "completed", execution }, walletAvailability: { status: "available", walletRunId: "00000000-0000-4000-8000-000000000001" }, progress: { status: "idle" } });
    expect(response.status).toBe("expired"); expect(response.pollingStatus).toBe("completed");
    expect(response.executionResult).toEqual(execution); expect(isWaitStoppingExecutionStatus("completed")).toBe(true);
    expect(isInteractionPendingReviewStatus("completed")).toBe(false);
  });
  it("observes a new review preparation even when a previous request already completed", () => {
    const completed = { ...request, requestStatus: "completed" as const };
    expect(reviewProgress(true, completed, { status: "available", walletRunId: "00000000-0000-4000-8000-000000000001" }, { stopped: false, pending: false })).toEqual({ status: "waiting" });
    expect(reviewProgress(false, completed, { status: "available", walletRunId: "00000000-0000-4000-8000-000000000001" }, { stopped: false, pending: false })).toEqual({ status: "idle" });
  });
});
