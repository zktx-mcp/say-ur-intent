import { z } from "zod";
import { assertNoForbiddenMcpFields } from "./forbiddenFields.js";
import {
  WALLET_REVIEW_REQUIRED_HUMAN_FIELDS,
  adapterHumanReadableReviewSchema
} from "./signableAdapterContract.js";
import type {
  HumanReadableReviewSummary
} from "./types.js";
import { humanReadableReviewSummarySchema } from "./schemas.js";
import {
  normalizedSuiAddressSchema,
  parseSuiAddress,
  suiTransactionDigestSchema
} from "../suiAddress.js";
import type {
  LocalTransactionMaterialDigestCommitment,
  LocalTransactionMaterialHandle
} from "../session/transactionMaterialStore.js";

export const HUMAN_READABLE_REVIEW_EVIDENCE_VERSION =
  "human-readable-review-v1";

const isoUtcStringSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected ISO 8601 UTC timestamp");

export const humanReadableReviewEvidenceSchema = z.object({
  evidenceVersion: z.literal(HUMAN_READABLE_REVIEW_EVIDENCE_VERSION),
  materialId: z.string().min(1),
  reviewSessionId: z.string().min(1),
  planId: z.string().min(1),
  account: normalizedSuiAddressSchema,
  transactionDigest: suiTransactionDigestSchema,
  kind: z.literal("human_readable_review"),
  adapterId: z.string().min(1).max(120),
  protocol: z.string().min(1).max(120),
  actionKind: z.string().min(1).max(120),
  network: z.literal("sui:mainnet"),
  fields: z.array(z.enum(WALLET_REVIEW_REQUIRED_HUMAN_FIELDS)).min(WALLET_REVIEW_REQUIRED_HUMAN_FIELDS.length),
  source: z.literal("review_model_or_adapter_equivalent"),
  purpose: z.literal("human_review_before_wallet_authorization"),
  review: humanReadableReviewSummarySchema,
  derivedAt: isoUtcStringSchema,
  expiresAt: isoUtcStringSchema
}).strict().superRefine((value, ctx) => {
  const duplicateField = findDuplicate(value.fields);
  if (duplicateField) {
    ctx.addIssue({
      code: "custom",
      path: ["fields"],
      message: `Human-readable review fields contains duplicate field '${duplicateField}'`
    });
  }
  if (!WALLET_REVIEW_REQUIRED_HUMAN_FIELDS.every((field) => value.fields.includes(field))) {
    ctx.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Human-readable review fields must include every required review field"
    });
  }
  if (
    value.review.freshness.evaluatedAt !== value.derivedAt ||
    value.review.freshness.expiresAt !== value.expiresAt
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["review", "freshness"],
      message: "review freshness must match evidence derivedAt and expiresAt"
    });
  }
  if (
    value.review.proposedAction.adapterId !== value.adapterId ||
    value.review.proposedAction.protocol !== value.protocol ||
    value.review.proposedAction.actionKind !== value.actionKind
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["review", "proposedAction"],
      message: "review proposedAction must match the human-readable review evidence identity"
    });
  }
});

export type HumanReadableReviewEvidence = z.infer<typeof humanReadableReviewEvidenceSchema>;

export function parseHumanReadableReviewEvidence(
  value: HumanReadableReviewEvidence
): HumanReadableReviewEvidence {
  return humanReadableReviewEvidenceSchema.parse(value);
}

export function createHumanReadableReviewEvidence(input: {
  transactionMaterial: LocalTransactionMaterialHandle;
  transactionMaterialDigest: LocalTransactionMaterialDigestCommitment;
  adapterId: string;
  protocol: string;
  actionKind: string;
  review: HumanReadableReviewSummary;
  derivedAt: Date;
}): HumanReadableReviewEvidence {
  return verifyHumanReadableReviewEvidence({
    transactionMaterial: input.transactionMaterial,
    transactionMaterialDigest: input.transactionMaterialDigest,
    evidence: {
      evidenceVersion: HUMAN_READABLE_REVIEW_EVIDENCE_VERSION,
      materialId: input.transactionMaterial.materialId,
      reviewSessionId: input.transactionMaterial.reviewSessionId,
      planId: input.transactionMaterial.planId,
      account: input.transactionMaterial.account,
      transactionDigest: input.transactionMaterialDigest.transactionDigest,
      kind: "human_readable_review",
      adapterId: input.adapterId,
      protocol: input.protocol,
      actionKind: input.actionKind,
      network: "sui:mainnet",
      fields: [...WALLET_REVIEW_REQUIRED_HUMAN_FIELDS],
      source: "review_model_or_adapter_equivalent",
      purpose: "human_review_before_wallet_authorization",
      review: input.review,
      derivedAt: input.derivedAt.toISOString(),
      expiresAt: input.transactionMaterial.expiresAt
    },
    now: input.derivedAt
  });
}

export function verifyHumanReadableReviewEvidence(input: {
  transactionMaterial: LocalTransactionMaterialHandle;
  transactionMaterialDigest: LocalTransactionMaterialDigestCommitment;
  evidence: HumanReadableReviewEvidence;
  now?: Date | undefined;
}): HumanReadableReviewEvidence {
  const evidence = parseHumanReadableReviewEvidence(input.evidence);
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error("now must be a valid Date");
  }

  if (
    evidence.materialId !== input.transactionMaterial.materialId ||
    evidence.reviewSessionId !== input.transactionMaterial.reviewSessionId ||
    evidence.planId !== input.transactionMaterial.planId ||
    evidence.account !== input.transactionMaterial.account ||
    evidence.expiresAt !== input.transactionMaterial.expiresAt ||
    evidence.transactionDigest !== input.transactionMaterialDigest.transactionDigest
  ) {
    throw new Error("human-readable review evidence must match material and digest identity");
  }

  if (
    input.transactionMaterialDigest.materialId !== input.transactionMaterial.materialId ||
    input.transactionMaterialDigest.reviewSessionId !== input.transactionMaterial.reviewSessionId ||
    input.transactionMaterialDigest.planId !== input.transactionMaterial.planId ||
    input.transactionMaterialDigest.account !== input.transactionMaterial.account ||
    input.transactionMaterialDigest.expiresAt !== input.transactionMaterial.expiresAt
  ) {
    throw new Error("transaction material digest must match material identity before human review evidence is accepted");
  }

  assertHumanReadableReviewConnectedAccount(evidence);
  assertHumanReadableReviewEvidenceSources(evidence);

  const materialCreatedAtMs = Date.parse(input.transactionMaterial.createdAt);
  const derivedAtMs = Date.parse(evidence.derivedAt);
  const expiresAtMs = Date.parse(evidence.expiresAt);
  if (derivedAtMs < materialCreatedAtMs || derivedAtMs > nowMs || derivedAtMs >= expiresAtMs) {
    throw new Error("human-readable review derivedAt must be between material creation, now, and material expiry");
  }
  if (expiresAtMs <= nowMs) {
    throw new Error("human-readable review evidence must not be expired");
  }

  adapterHumanReadableReviewSchema.parse({
    fields: evidence.fields,
    transactionDigest: evidence.transactionDigest,
    source: evidence.source,
    purpose: evidence.purpose
  });
  assertNoForbiddenMcpFields(evidence.review);

  return evidence;
}

export function publicHumanReadableReviewFromEvidence(
  evidenceInput: HumanReadableReviewEvidence
): HumanReadableReviewSummary {
  const evidence = parseHumanReadableReviewEvidence(evidenceInput);
  assertNoForbiddenMcpFields(evidence.review);
  return humanReadableReviewSummarySchema.parse(structuredClone(evidence.review));
}

function findDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

function assertHumanReadableReviewConnectedAccount(
  evidence: HumanReadableReviewEvidence
): void {
  const recipientsByRole = new Map<string, string>();
  for (const recipient of evidence.review.recipients) {
    if (recipientsByRole.has(recipient.role)) {
      throw new Error(`human-readable review recipients contains duplicate role '${recipient.role}'`);
    }
    const normalizedAddress = parseSuiAddress(recipient.address);
    if (!normalizedAddress) {
      throw new Error("human-readable review recipients must contain valid Sui addresses");
    }
    recipientsByRole.set(recipient.role, normalizedAddress);
  }
  if (recipientsByRole.get("connected_account") !== evidence.account) {
    throw new Error("human-readable review connected account recipient must match the reviewed account");
  }
}

export function assertPreSimulationHumanReadableReviewBoundaryClaims(
  evidence: HumanReadableReviewEvidence
): void {
  requireGapId(
    "missingEvidence",
    evidence.review.missingEvidence,
    "review_time_simulation"
  );
  requireGapId(
    "requiredUserChoices",
    evidence.review.requiredUserChoices,
    "wallet_authorization_later"
  );
  for (const id of [
    "no_signing_readiness",
    "no_execution_readiness"
  ]) {
    requireGapId("unsupportedClaims", evidence.review.unsupportedClaims, id);
  }
  if (
    !evidence.review.blockingChecks.some(
      (check) =>
        check.source === "simulation" &&
        check.status === "fail"
    )
  ) {
    throw new Error("human-readable review blockingChecks must include a failed simulation check");
  }
}

function assertHumanReadableReviewEvidenceSources(
  evidence: HumanReadableReviewEvidence
): void {
  for (const source of ["digest_commitment"]) {
    requireFactSource(evidence.review.evidenceUsed, source);
  }
}

function requireFactSource(
  facts: readonly { source: string }[],
  source: string
): void {
  if (!facts.some((fact) => fact.source === source)) {
    throw new Error(`human-readable review evidenceUsed must include source '${source}'`);
  }
}

function requireGapId(
  label: string,
  gaps: readonly { id: string }[],
  id: string
): void {
  if (!gaps.some((gap) => gap.id === id)) {
    throw new Error(`human-readable review ${label} must include '${id}'`);
  }
}
