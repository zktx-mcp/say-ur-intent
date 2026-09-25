import { z } from "zod";
import { suiAddressStringSchema, suiTransactionDigestSchema } from "../suiAddress.js";
import { suiChainReceiptEvidenceSchema } from "../action/suiChainReceiptEvidence.js";

export const TRANSACTION_REQUEST_STATUSES = [
  "awaiting_signature", "submitting", "awaiting_chain_result", "stopped",
  "request_failed", "outcome_unknown", "completed"
] as const;
export const transactionRequestStatusSchema = z.enum(TRANSACTION_REQUEST_STATUSES);
export type TransactionRequestStatus = z.infer<typeof transactionRequestStatusSchema>;

// The submission was admitted durably before external I/O. A failed follow-up
// write must not remove its initial observation window or replacement guard.
export const INITIAL_CHAIN_OBSERVATION_STATUSES = ["submitting", "awaiting_chain_result"] as const;
export function isInitialChainObservation(status: TransactionRequestStatus): boolean {
  return INITIAL_CHAIN_OBSERVATION_STATUSES.some((value) => value === status);
}

// This is the existing signing surface's local wait, independent of protocol
// request expiry, card input expiry and the chain observation window.
export const SIGNATURE_WAIT_MS = 90_000;
export const CHAIN_RECEIPT_LOOKUP_MAX_AGE_MS = 10 * 60 * 1000;

export const transactionExecutionSummarySchema = z.object({
  reviewSessionId: z.string().min(1),
  attemptId: z.string().min(1),
  planId: z.string().min(1),
  status: z.enum(["success", "failure"]),
  txDigest: suiTransactionDigestSchema,
  chainReceipt: suiChainReceiptEvidenceSchema,
  failureReason: z.literal("chain_execution_failed").optional(),
  recordedAt: z.string().datetime()
}).strict().superRefine((result, context) => {
  if (result.txDigest !== result.chainReceipt.txDigest || (result.status === "success") !== result.chainReceipt.effectsStatus.success) {
    context.addIssue({ code: "custom", message: "Execution must match the observed chain receipt." });
  }
  if ((result.status === "failure") !== (result.failureReason !== undefined)) {
    context.addIssue({ code: "custom", message: "Only a chain failure has a chain execution failure reason." });
  }
});
export type TransactionExecutionSummary = z.infer<typeof transactionExecutionSummarySchema>;

export const transactionRequestSchema = z.object({
  attemptId: z.string().min(1),
  reviewSessionId: z.string().min(1),
  planId: z.string().min(1),
  reviewRevision: z.number().int().nonnegative(),
  account: suiAddressStringSchema,
  transactionDigest: suiTransactionDigestSchema,
  requestStatus: transactionRequestStatusSchema,
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  signatureVerifiedAt: z.string().datetime().optional(),
  submittedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
  execution: transactionExecutionSummarySchema.optional()
}).strict().superRefine((request, context) => {
  const execution = request.execution;
  if ((request.requestStatus === "completed") !== (execution !== undefined)) {
    context.addIssue({ code: "custom", message: "Completed requests require an observed execution result." });
  }
  if (execution && (execution.attemptId !== request.attemptId || execution.reviewSessionId !== request.reviewSessionId ||
      execution.planId !== request.planId || execution.txDigest !== request.transactionDigest || execution.chainReceipt.sender !== request.account)) {
    context.addIssue({ code: "custom", message: "Execution identity differs from the admitted request." });
  }
});
export type TransactionRequest = z.infer<typeof transactionRequestSchema>;

export function isRequestWaiting(status: TransactionRequestStatus): boolean {
  return status === "awaiting_signature" || isInitialChainObservation(status);
}

export const requestTransitions: Readonly<Record<TransactionRequestStatus, readonly TransactionRequestStatus[]>> = {
  awaiting_signature: ["submitting", "stopped", "request_failed", "outcome_unknown"],
  submitting: ["awaiting_chain_result", "outcome_unknown", "completed"],
  awaiting_chain_result: ["outcome_unknown", "completed"],
  stopped: [],
  request_failed: [],
  outcome_unknown: ["awaiting_chain_result", "completed"],
  completed: []
};
