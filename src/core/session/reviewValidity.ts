import { isDeepStrictEqual } from "node:util";
import { REVIEW_MATERIAL_DERIVED_FIELDS, type ReviewSession } from "../action/types.js";
import type { EventLogRecord } from "../eventlog/sink.js";
import type { PrivateReviewArtifacts } from "./privateReviewArtifacts.js";
import { sameHandle, type LocalTransactionMaterialHandle, type LocalTransactionMaterialDigestCommitment,
  type LocalTransactionMaterialRecord } from "./transactionMaterialStore.js";
import { SessionStoreError } from "./sessionErrors.js";

// Private, call-scoped verification evidence. This is never admission authority.
export type ValidatedReviewMaterial = {
  reviewSessionId: string; reviewRevision: number; rowRevision: number;
  review: ReviewSession; artifacts: PrivateReviewArtifacts;
  planId: string; account: string; reviewedTransactionDigest: string;
  transactionMaterial: LocalTransactionMaterialHandle;
  transactionMaterialDigest: LocalTransactionMaterialDigestCommitment;
  transactionBytesBase64: string;
};
export type ReviewEvaluationCandidate = {
  session: ReviewSession; rowRevision: number;
  artifacts?: PrivateReviewArtifacts | undefined;
  material?: ValidatedReviewMaterial | undefined;
};
export type ReviewEvaluation = { session: ReviewSession; events: EventLogRecord[] };

export function needsReviewMaterial(session: ReviewSession, admitted: boolean): boolean {
  return !admitted && !session.preparationId && session.status !== "expired" &&
    !!session.reviewState && REVIEW_MATERIAL_DERIVED_FIELDS.some((field) => session.reviewState![field] !== undefined);
}

export function invalidateReviewEvidence(session: ReviewSession, now: Date): ReviewSession {
  if (session.reviewState && session.reviewState.status !== "ready_for_wallet_review") {
    const state = { ...session.reviewState, evidenceValidity: "invalidated" as const, updatedAt: now.toISOString() };
    for (const field of REVIEW_MATERIAL_DERIVED_FIELDS) delete state[field];
    // Keep the computation's failure reason, checks and stage provenance. Their
    // presence describes that failed attempt, not currently usable material.
    return { ...session, lastActivityAt: now.toISOString(), reviewState: state };
  }
  return { ...session, status: "refresh_required", lastActivityAt: now.toISOString(),
    ...(session.reviewState ? { reviewState: {
      planId: session.reviewState.planId, reviewSessionId: session.id, account: session.reviewState.account,
      status: "refresh_required", refreshReason: "review_evidence_stale",
      checks: [{ id: "private_review_artifacts_refresh_required", label: "Review details out of date", status: "fail",
        message: "These review details are no longer current.", source: "adapter" }],
      updatedAt: now.toISOString()
    } } : {}) };
}

export function materialStillMatches(verified: ValidatedReviewMaterial, session: ReviewSession, rowRevision: number,
  artifacts: PrivateReviewArtifacts | undefined, material: LocalTransactionMaterialRecord | undefined, now: Date): boolean {
  return session.id === verified.reviewSessionId && session.reviewRevision === verified.reviewRevision &&
    rowRevision === verified.rowRevision && session.account === verified.account &&
    session.reviewState?.planId === verified.planId &&
    isDeepStrictEqual(artifacts, verified.artifacts) && !!artifacts?.transactionMaterial && sameHandle(artifacts.transactionMaterial, verified.transactionMaterial) &&
    isDeepStrictEqual(artifacts.transactionMaterialDigest, verified.transactionMaterialDigest) &&
    !!material && sameHandle(material, verified.transactionMaterial) && Date.parse(material.expiresAt) > now.getTime() &&
    Buffer.from(material.transactionBytes).toString("base64") === verified.transactionBytesBase64;
}

// The caller owns a synchronous transaction and supplies its one decision time.
export function decideReviewEvaluation(candidate: ReviewEvaluationCandidate, current: ReviewSession, rowRevision: number,
  artifacts: PrivateReviewArtifacts | undefined, material: LocalTransactionMaterialRecord | undefined,
  admitted: boolean, now: Date): ReviewSession {
  if (current.status !== "expired" && Date.parse(current.expiresAt) <= now.getTime()) {
    return { ...current, status: "expired" };
  }
  if (!needsReviewMaterial(current, admitted)) return current;
  if (candidate.rowRevision !== rowRevision || !isDeepStrictEqual(candidate.session, current) ||
      !isDeepStrictEqual(candidate.artifacts, artifacts)) {
    throw new SessionStoreError("invalid_session_transition", "The review changed while it was being checked.",
      { reason: "review_changed_during_verification", message: "The review changed while it was being checked." });
  }
  return candidate.material && materialStillMatches(candidate.material, current, rowRevision, artifacts, material, now)
    ? current : invalidateReviewEvidence(current, now);
}
