import { workflowActions, type EvaluatedWorkflowState } from "./workflowState.js";
export type { ConnectionView, WorkflowAction } from "./workflowState.js";
import { z } from "zod";
import { suiAddressStringSchema, parseSuiAddress } from "../suiAddress.js";
import { actionPlanSchema, internalSessionStatusSchema, reviewStateOutputSchema } from "../action/schemas.js";
import { walletConnectionSchema, walletAvailabilitySchema, workflowProgressSchema, WALLET_CONNECTION_POLL_SECONDS } from "./walletConnection.js";
import { transactionRequestSchema } from "./transactionRequest.js";
import { workflowProgress } from "./walletConnection.js";
import { reviewProgress, EXECUTION_POLLING_INTERVAL_SECONDS } from "./status.js";
import { walletRunIdSchema, walletRecoverySchema, walletObservationSchema, walletRecoveryImpactSchema } from "./walletRuntime.js";

export const CONNECT_BOUNDARY = "A wallet connection provides account context; it is not a transaction approval or proof of address ownership.";
export const REVIEW_BOUNDARY = "Review evidence is not a safety guarantee. Only an explicit card action and wallet approval may authorize this exact transaction.";
// A projection of an admitted card operation, not a new wallet connection state.
export const connectionViewSchema = walletConnectionSchema.extend({ pendingAction: z.literal("disconnect").optional() });
export const assetReadAccountSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), account: suiAddressStringSchema }).strict(),
  z.object({ status: z.literal("address_required") }).strict()
]);
export type AssetReadAccount = z.infer<typeof assetReadAccountSchema>;
export const pendingConnectionStatusSchema = z.enum(["input_required", "awaiting_approval", "disconnect_pending", "wallet_recovery_pending"]);
export type PendingConnectionStatus = z.infer<typeof pendingConnectionStatusSchema>;
// The MCP presentation layer supplies the tool name; core only defines the
// optional display payload and decides whether a recovery route is relevant.
export const walletRecoveryGuidanceSchema = z.object({ message: z.string(),
  openControls: z.object({ tool: z.string(), intent: z.literal("manage") }).strict() }).strict();
export function walletRecoveryRoute(input: {
  walletAvailability: z.infer<typeof walletAvailabilitySchema>; waiting: boolean;
  runtimeRecovery?: z.infer<typeof walletRecoverySchema> | undefined;
}): "conditional" | "unavailable" | undefined {
  if (input.walletAvailability.status === "recovering" || input.runtimeRecovery && "phase" in input.runtimeRecovery && input.runtimeRecovery.phase === "stopping") return undefined;
  if (input.walletAvailability.status === "unavailable") return "unavailable";
  if (input.walletAvailability.status === "initializing" || input.waiting) return "conditional";
  return undefined;
}
export function connectionRecoveryRoute(data: Pick<WorkflowView, "walletAvailability" | "runtimeRecovery" | "connections">) {
  return walletRecoveryRoute({ ...data, waiting: data.connections.some((item) => item.status === "awaiting_approval" || item.pendingAction === "disconnect") });
}

const connectAction = z.object({ action: z.literal("connect"), walletRunId: walletRunIdSchema }).strict();
const restartAction = z.object({ action: z.literal("restart_wallet_service"), walletRunId: walletRunIdSchema }).strict();
const disconnectAction = z.object({ action: z.literal("disconnect"), walletRunId: walletRunIdSchema, connectionId: z.string().min(1) }).strict();
const accountAction = z.object({ action: z.literal("use_account"), walletRunId: walletRunIdSchema, connectionId: z.string().min(1), account: suiAddressStringSchema }).strict();
const reviewAction = z.object({ action: z.enum(["prepare_review", "request_signature"]), connectionId: z.string().min(1),
  walletRunId: walletRunIdSchema, account: suiAddressStringSchema, reviewRevision: z.number().int().nonnegative() }).strict();
const simpleAction = z.object({ action: z.enum(["cancel", "stop_connection", "stop_waiting", "read_result"]) }).strict();
export const workflowActionSchema = z.union([connectAction, restartAction, disconnectAction, accountAction, reviewAction, simpleAction]);
export const automaticWorkflowActionSchema = z.union([connectAction, reviewAction.extend({ action: z.literal("prepare_review") })]);
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
  automaticAction: automaticWorkflowActionSchema.optional(),
  observe: z.boolean(),
  walletAvailability: walletAvailabilitySchema,
  walletObservation: walletObservationSchema.optional(),
  runtimeRecovery: walletRecoverySchema.optional(),
  recoveryImpact: walletRecoveryImpactSchema.optional(),
  acceptedWalletRunId: walletRunIdSchema.optional(),
  progress: workflowProgressSchema,
  boundary: z.enum([CONNECT_BOUNDARY, REVIEW_BOUNDARY]),
  connections: z.array(connectionViewSchema),
  activeAccount: z.string().optional(),
  connection: connectionViewSchema.optional(),
  connectionAction: z.enum(["connect", "disconnect"]).optional(),
  walletRecoveryGuidance: walletRecoveryGuidanceSchema.optional(),
  review: z.object({
    reviewSessionId: z.string(), plan: actionPlanSchema, reviewRevision: z.number().int().nonnegative(),
    status: internalSessionStatusSchema, account: z.string().optional(), preparing: z.boolean(),
    accountRequestPending: z.literal(true).optional(),
    error: z.string().optional(),
    state: reviewStateOutputSchema.optional()
  }).strict().optional(),
  request: transactionRequestSchema.optional(),
  receipt: z.unknown().optional(),
  netGasMist: z.string().regex(/^-?[0-9]+$/).optional(),
  observationStopped: z.boolean().optional()
}).strict();
export type WorkflowView = z.infer<typeof workflowViewSchema>;

// Automatic preparation uses the same current selection and typed admission as
// a deliberate retry. A failed computation is not a reason to compute in a loop.
function automaticReviewAction(input: EvaluatedWorkflowState) {
  const { record, session, request } = input;
  if (!session || record?.scope !== "review" || request || session.preparationError ||
      !input.allowedActions.includes("prepare_review")) return undefined;
  const needsPreparation = !session.reviewState && session.reviewRevision === 0 ||
    session.reviewState?.status === "refresh_required" && session.reviewState.refreshReason === "review_evidence_stale";
  if (!needsPreparation || !input.activeAccount) return undefined;
  const candidates = reviewWalletChoices(input.connections, input.activeAccount);
  if (candidates.length !== 1) return undefined;
  return { action: "prepare_review" as const, walletRunId: input.walletAvailability.walletRunId, connectionId: candidates[0]!.connectionId,
    account: input.activeAccount, reviewRevision: session.reviewRevision };
}

// Method support filters wallet choices; it does not authorize a signature.
export function reviewWalletChoices(connections: WorkflowView["connections"], account: string, requireSigningMethod = false) {
  return connections.filter((item) => item.status === "connected" && !item.pendingAction && item.accounts.includes(account) &&
    (!requireSigningMethod || item.methods.includes("sui_signTransaction")));
}

function nextStateRead(input: EvaluatedWorkflowState): number | undefined {
  const walletInput = input.record?.state.state === "ready" && input.record.scope !== "review_manage" && !input.request &&
    !input.session?.plans[0]?.reviewModel && input.inputRemainingMs > 0;
  const startup = walletInput && ["initializing", "recovering"].includes(input.walletAvailability.status);
  const delays = [input.nextStateReadAfterMs, startup ? WALLET_CONNECTION_POLL_SECONDS * 1000 : undefined,
    walletInput && input.record?.scope === "review" && input.busyForAccount ? EXECUTION_POLLING_INTERVAL_SECONDS * 1000 : undefined]
    .filter((value): value is number => value !== undefined && value > 0);
  return delays.length ? Math.min(...delays) : undefined;
}

// These projections do not read clocks, storage, or admission rules. The
// evaluated facts and choices were collected together by the database owner.
export function projectConnectionView(input: EvaluatedWorkflowState): WorkflowView {
  const { connection, walletAvailability } = input;
  const readAfter = nextStateRead(input);
  const progress = input.runtimeRecovery ? { status: "phase" in input.runtimeRecovery ? "waiting" as const : "idle" as const } :
    workflowProgress(connection?.status === "awaiting_approval" || connection?.pendingAction === "disconnect", true, walletAvailability);
  return workflowViewSchema.parse({ kind: "connect", mode: "connect", allowedActions: input.allowedActions,
    actionRemainingMs: input.actionRemainingMs, observe: progress.status === "waiting", progress, walletAvailability,
    ...(input.allowedActions.includes("connect")
      ? { automaticAction: { action: "connect", walletRunId: walletAvailability.walletRunId } } : {}),
    runtimeRecovery: input.runtimeRecovery, walletObservation: input.walletObservation,
    recoveryImpact: input.recoveryImpact,
    connectionAction: ["connect", "disconnect"].includes(String(input.record?.acceptedInput?.action)) ? input.record?.acceptedInput?.action : undefined,
    acceptedWalletRunId: input.record?.acceptedInput?.walletRunId,
    ...(readAfter === undefined ? {} : { nextStateReadAfterMs: readAfter }),
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
  const automaticAction = automaticReviewAction(input);
  const readAfter = nextStateRead(input);
  return workflowViewSchema.parse({ kind: "review", mode: record.scope === "review_manage" ? "review_manage" : "review",
    allowedActions: input.allowedActions, actionRemainingMs: input.actionRemainingMs, observe: progress.status === "waiting", progress, walletAvailability,
    connections: input.connections, activeAccount: input.activeAccount, boundary: REVIEW_BOUNDARY, receipt: input.receipt,
    walletObservation: input.walletObservation,
    acceptedWalletRunId: record.acceptedInput?.walletRunId,
    ...(readAfter === undefined ? {} : { nextStateReadAfterMs: readAfter }),
    ...(automaticAction ? { automaticAction } : {}),
    netGasMist: gas ? (BigInt(gas.computationCostRaw) + BigInt(gas.storageCostRaw) - BigInt(gas.storageRebateRaw)).toString() : undefined,
    review: { reviewSessionId: session.id, plan: session.plans[0], reviewRevision: boundReview && request ? request.reviewRevision : session.reviewRevision,
      status: boundReview?.status ?? session.status, account: boundReview?.account ?? session.account,
      ...(!request && !session.plans[0]?.reviewModel && input.busyForAccount ? { accountRequestPending: true } : {}),
      preparing: !boundReview && !!session.preparationId,
      error: !boundReview ? [input.preparationIssue && `Current account selection: ${input.preparationIssue}`,
        session.preparationError && `Earlier review message: “${session.preparationError}”`].filter(Boolean).join("\n\n") || undefined : undefined,
      state: displayedReview },
    request, observationStopped: authority ? authority.observation_stopped === 1 : undefined });
}
