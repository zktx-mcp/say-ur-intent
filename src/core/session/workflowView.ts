import { workflowActions, type EvaluatedWorkflowState } from "./workflowState.js";
export type { ConnectionView, WorkflowAction } from "./workflowState.js";
import { z } from "zod";
import { suiAddressStringSchema, parseSuiAddress } from "../suiAddress.js";
import { actionPlanSchema, internalSessionStatusSchema, reviewStateOutputSchema } from "../action/schemas.js";
import { walletConnectionSchema, walletAvailabilitySchema, workflowProgressSchema } from "./walletConnection.js";
import { transactionRequestSchema } from "./transactionRequest.js";
import { workflowProgress } from "./walletConnection.js";
import { reviewProgress } from "./status.js";

export const CONNECT_BOUNDARY = "A wallet connection provides account context; it is not a transaction approval or proof of address ownership.";
export const REVIEW_BOUNDARY = "Review evidence is not a safety guarantee. Only an explicit card action and wallet approval may authorize this exact transaction.";
// A projection of an admitted card operation, not a new wallet connection state.
export const connectionViewSchema = walletConnectionSchema.extend({ pendingAction: z.literal("disconnect").optional() });
export const assetReadAccountSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), account: suiAddressStringSchema }).strict(),
  z.object({ status: z.literal("address_required") }).strict()
]);
export type AssetReadAccount = z.infer<typeof assetReadAccountSchema>;
export const pendingConnectionStatusSchema = z.enum(["input_required", "awaiting_approval", "disconnect_pending"]);
export type PendingConnectionStatus = z.infer<typeof pendingConnectionStatusSchema>;

const connectAction = z.object({ action: z.literal("connect") }).strict();
const disconnectAction = z.object({ action: z.literal("disconnect"), connectionId: z.string().min(1) }).strict();
const accountAction = z.object({ action: z.literal("use_account"), connectionId: z.string().min(1), account: suiAddressStringSchema }).strict();
const reviewAction = z.object({ action: z.enum(["prepare_review", "request_signature"]), connectionId: z.string().min(1),
  account: suiAddressStringSchema, reviewRevision: z.number().int().nonnegative() }).strict();
const simpleAction = z.object({ action: z.enum(["cancel", "stop_connection", "stop_waiting", "read_result"]) }).strict();
export const workflowActionSchema = z.union([connectAction, disconnectAction, accountAction, reviewAction, simpleAction]);
export function parseWorkflowAction(input: unknown) {
  const action = workflowActionSchema.parse(input);
  return "account" in action ? { ...action, account: parseSuiAddress(action.account)! } : action;
}


export const workflowViewSchema = z.object({
  kind: z.enum(["connect", "review"]),
  mode: z.enum(["connect", "review", "review_manage"]),
  allowedActions: z.array(z.enum(workflowActions)),
  actionRemainingMs: z.number().int().nonnegative(),
  nextStateReadAfterMs: z.number().int().nonnegative().optional(),
  observe: z.boolean(),
  walletAvailability: walletAvailabilitySchema,
  progress: workflowProgressSchema,
  boundary: z.enum([CONNECT_BOUNDARY, REVIEW_BOUNDARY]),
  connections: z.array(connectionViewSchema),
  activeAccount: z.string().optional(),
  connection: connectionViewSchema.optional(),
  review: z.object({
    reviewSessionId: z.string(), plan: actionPlanSchema, reviewRevision: z.number().int().nonnegative(),
    status: internalSessionStatusSchema, account: z.string().optional(), preparing: z.boolean(),
    error: z.string().optional(),
    state: reviewStateOutputSchema.optional()
  }).strict().optional(),
  request: transactionRequestSchema.optional(),
  receipt: z.unknown().optional(),
  netGasMist: z.string().regex(/^-?[0-9]+$/).optional(),
  observationStopped: z.boolean().optional()
}).strict();
export type WorkflowView = z.infer<typeof workflowViewSchema>;

// These projections do not read clocks, storage, or admission rules. The
// evaluated facts and choices were collected together by the database owner.
export function projectConnectionView(input: EvaluatedWorkflowState): WorkflowView {
  const { connection, walletAvailability } = input;
  const progress = workflowProgress(connection?.status === "awaiting_approval" || connection?.pendingAction === "disconnect", true, walletAvailability);
  return workflowViewSchema.parse({ kind: "connect", mode: "connect", allowedActions: input.allowedActions,
    actionRemainingMs: input.actionRemainingMs, observe: progress.status === "waiting", progress, walletAvailability,
    connections: input.connections, activeAccount: input.activeAccount, connection, boundary: CONNECT_BOUNDARY });
}

export function projectReviewView(input: EvaluatedWorkflowState): WorkflowView {
  const { record, session, request, authority, walletAvailability, boundReview } = input;
  if (!record || !session) throw new Error("Review projection requires an evaluated card and session.");
  const progress = reviewProgress(!boundReview && !!session.preparationId, request, walletAvailability, {
    stopped: authority?.observation_stopped === 1, pending: authority?.lookup_pending === 1
  });
  const displayedReview = boundReview ?? session.reviewState;
  const gas = displayedReview?.simulation?.gasCostSummary;
  return workflowViewSchema.parse({ kind: "review", mode: record.scope === "review_manage" ? "review_manage" : "review",
    allowedActions: input.allowedActions, actionRemainingMs: input.actionRemainingMs, observe: progress.status === "waiting", progress, walletAvailability,
    connections: input.connections, activeAccount: input.activeAccount, boundary: REVIEW_BOUNDARY, receipt: input.receipt,
    ...(input.nextStateReadAfterMs === undefined ? {} : { nextStateReadAfterMs: input.nextStateReadAfterMs }),
    netGasMist: gas ? (BigInt(gas.computationCostRaw) + BigInt(gas.storageCostRaw) - BigInt(gas.storageRebateRaw)).toString() : undefined,
    review: { reviewSessionId: session.id, plan: session.plans[0], reviewRevision: boundReview && request ? request.reviewRevision : session.reviewRevision,
      status: boundReview?.status ?? session.status, account: boundReview?.account ?? session.account,
      preparing: !boundReview && !!session.preparationId,
      error: !boundReview ? [input.preparationIssue && `Current account selection: ${input.preparationIssue}`,
        session.preparationError && `Previous review update: ${session.preparationError}`].filter(Boolean).join("\n\n") || undefined : undefined,
      state: displayedReview },
    request, observationStopped: authority ? authority.observation_stopped === 1 : undefined });
}
