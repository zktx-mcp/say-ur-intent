import { connectionRecoveryRoute, walletRecoveryGuidanceSchema, workflowViewSchema,
  type walletRecoveryRoute } from "../core/session/workflowView.js";
import type { CardSnapshot } from "../core/session/cardSession.js";
import { TOOL_NAMES } from "./toolNames.js";

export function walletRecoveryGuidance(route: ReturnType<typeof walletRecoveryRoute>) {
  if (!route) return undefined;
  return walletRecoveryGuidanceSchema.parse({
    message: route === "unavailable"
      ? "Ask in chat to open wallet connection controls. You can restart the wallet service there after confirming the effects."
      : "If this request is not responding, ask in chat to open wallet connection controls. You can restart the wallet service there after confirming the effects.",
    openControls: { tool: TOOL_NAMES.sessionCreateWalletConnection, intent: "manage" }
  });
}

// Shared by action replies, public saved resources, and connection get/wait.
// This describes a route for the user, never app-only execution authority.
export function cardWithRecoveryGuidance(snapshot: CardSnapshot): CardSnapshot {
  if (snapshot.kind !== "connect") return snapshot;
  const parsed = workflowViewSchema.safeParse(snapshot.data);
  // Preserve the existing display-error recovery for a malformed projection;
  // optional guidance must not prevent the original card from being delivered.
  if (!parsed.success) return snapshot;
  const data = parsed.data;
  const guidance = walletRecoveryGuidance(connectionRecoveryRoute(data));
  return { ...snapshot, data: { ...data, ...(guidance ? { walletRecoveryGuidance: guidance } : {}) } };
}
