import { walletAvailabilitySchema, workflowProgressSchema, walletUnavailable } from "../../../core/session/walletConnection.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { activeAccountResponse, activeAccountResponseSchema } from "../../activeAccountResponse.js";
import type { McpServerDeps } from "../../server.js";
import { errorToolResult, okToolResult } from "../../result.js";
import { noParamsInputSchema, successOutputSchema } from "../../schemas.js";
import { activityStoreToolError, sessionStoreToolError } from "../../toolErrors.js";
import { TOOL_NAMES } from "../../toolNames.js";
import { interactionStatusUserAnswerUse, reviewStatusUserAnswerUse } from "../../responseGuidance.js";
import { userAnswerUseSchema } from "../read/commonSchemas.js";
import { isReviewInteractionPending, reviewStatusResponse } from "../../../core/session/status.js";
import { latest, reviewStatusResponseShape, readCurrentReview } from "./shared.js";
import { pendingConnectionStatusSchema } from "../../../core/session/workflowView.js";

export function registerSessionStatusTools(server: McpServer, deps: McpServerDeps): void {
  server.registerTool(TOOL_NAMES.sessionGetInteractionStatus, {
    title: "Get local interaction status", description: "Read the active account and pending connection or review interactions.",
    inputSchema: noParamsInputSchema,
    outputSchema: successOutputSchema({ walletAvailability: walletAvailabilitySchema, activeAccount: activeAccountResponseSchema,
      pendingWalletConnections: z.object({ limit: z.number().int().positive(), truncated: z.boolean(),
        items: z.array(z.object({ cardId: z.string(), connectionId: z.string().optional(),
          status: pendingConnectionStatusSchema, progress: workflowProgressSchema, lastActivityAt: z.string() })) }),
      pendingReviewSessions: z.object({ limit: z.number().int().positive(), truncated: z.boolean(), items: z.array(z.object(reviewStatusResponseShape)) }),
      userAnswerUse: userAnswerUseSchema }),
    annotations: { readOnlyHint: false, openWorldHint: false }
  }, async () => {
    let active;
    try { active = await deps.activityStore.getActiveAccount(); }
    catch (error) { return activityStoreToolError(error, deps.logger); }
    try {
      deps.workflow?.refreshConnections();
      const states = await Promise.all(deps.sessions.reviewSessionIds().map((id) => readCurrentReview(deps, id)));
      const reviews = states.flatMap((state) => state && isReviewInteractionPending(state) ? [reviewStatusResponse(state)] : []);
      const connections = deps.workflow?.pendingConnections() ?? [];
      return okToolResult({ activeAccount: activeAccountResponse(active), pendingWalletConnections: latest(connections),
        pendingReviewSessions: latest(reviews), walletAvailability: deps.workflow?.walletAvailability() ?? walletUnavailable("configuration_missing"),
        userAnswerUse: interactionStatusUserAnswerUse() });
    } catch (error) { return sessionStoreToolError(error, deps.logger); }
  });
  server.registerTool(TOOL_NAMES.sessionGetReviewStatus, {
    title: "Get review status", description: "Read one review session, its admitted request and any observed chain result.",
    inputSchema: { reviewSessionId: z.string().min(1) },
    outputSchema: successOutputSchema({ ...reviewStatusResponseShape, userAnswerUse: userAnswerUseSchema }),
    annotations: { readOnlyHint: false, openWorldHint: false }
  }, async ({ reviewSessionId }) => {
    try {
      const state = await readCurrentReview(deps, reviewSessionId);
      if (!state) return errorToolResult({ kind: "session_not_found", details: { reviewSessionId } });
      const session = state.session;
      return okToolResult({ ...reviewStatusResponse(state),
        userAnswerUse: reviewStatusUserAnswerUse(!!session.reviewState, !!session.reviewState?.adapterLifecycle,
          !!session.reviewState?.humanReadableReview, !!session.reviewState?.simulation) });
    } catch (error) { return sessionStoreToolError(error, deps.logger); }
  });
}
