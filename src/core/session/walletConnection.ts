import { z } from "zod";
import { suiAddressStringSchema } from "../suiAddress.js";

export const SUI_MAINNET_WALLET_CHAIN = "sui:mainnet" as const;
export const SUI_SIGN_TRANSACTION_METHOD = "sui_signTransaction" as const;
export const WALLET_CONNECTION_POLL_SECONDS = 5;
export const walletUnavailableReasonSchema = z.enum([
  "initialization_failed", "restoration_failed", "wallet_state_unavailable"
]);
export type WalletUnavailableReason = z.infer<typeof walletUnavailableReasonSchema>;
export const walletAvailabilitySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available") }).strict(),
  z.object({ status: z.literal("unavailable"), reason: walletUnavailableReasonSchema, message: z.string() }).strict()
]);
export type WalletAvailability = z.infer<typeof walletAvailabilitySchema>;
export function walletUnavailable(reason: WalletUnavailableReason): Extract<WalletAvailability, { status: "unavailable" }> {
  const message = reason === "restoration_failed"
    ? "Wallet connections could not be restored."
    : reason === "wallet_state_unavailable"
      ? "The wallet connection status could not be checked. Saved transaction results remain available."
      : "The wallet connection service could not start.";
  return { status: "unavailable", reason, message };
}
export class WalletUnavailableError extends Error {
  constructor(readonly reason: WalletUnavailableReason) { super(walletUnavailable(reason).message); }
}
export const workflowProgressSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }).strict(),
  z.object({ status: z.literal("waiting") }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.literal("wallet_unavailable"), message: z.string() }).strict()
]);
export type WorkflowProgress = z.infer<typeof workflowProgressSchema>;
export function workflowProgress(waiting: boolean, requiresWallet: boolean, availability: WalletAvailability): WorkflowProgress {
  if (!waiting) return { status: "idle" };
  if (requiresWallet && availability.status === "unavailable") {
    return { status: "unavailable", reason: "wallet_unavailable", message: availability.message };
  }
  return { status: "waiting" };
}
export const walletConnectionStatusSchema = z.enum([
  "awaiting_approval", "connected", "rejected", "failed", "expired", "stopped", "disconnected"
]);
export const walletConnectionSchema = z.object({
  connectionId: z.string().min(1),
  status: walletConnectionStatusSchema,
  revision: z.number().int().nonnegative(),
  accounts: z.array(suiAddressStringSchema),
  methods: z.array(z.string()),
  chain: z.literal(SUI_MAINNET_WALLET_CHAIN),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  walletName: z.string().optional(),
  reason: z.string().optional()
}).strict();
export type WalletConnection = z.infer<typeof walletConnectionSchema>;
export type WalletConnectionStatus = WalletConnection["status"];
export class WalletUserRejectedError extends Error {
  constructor() { super("The wallet request was rejected by the user."); }
}

// A private backend reference, never part of the model or card response.
export type WalletConnectionRecord = {
  connection: WalletConnection;
  ownerId: string;
  topic?: string;
  sdkPending: boolean;
};

// Shared recorded connection facts only. Each operation checks its own expiry,
// account, method and revision requirements at its decision boundary.
export function isOwnedConnectedWallet(record: WalletConnectionRecord | undefined, ownerId: string,
  disconnectPending: boolean): record is WalletConnectionRecord {
  return !!record && record.ownerId === ownerId && record.connection.status === "connected" && !disconnectPending;
}

export type WalletSession = {
  topic: string;
  accounts: string[];
  methods: string[];
  chain: typeof SUI_MAINNET_WALLET_CHAIN;
  expiresAt: string;
  walletName?: string;
};

export interface WalletTransport {
  restore(): Promise<WalletSession[]>;
  connect(): Promise<{ uri: string; expiresAt: string; approval: Promise<WalletSession> }>;
  disconnect(topic: string): Promise<void>;
  sign(input: { topic: string; account: string; transactionBytesBase64: string }): Promise<{
    transactionBytes: string; signature: string;
  }>;
  onSessionChanged(listener: (topic: string, selectionChanged?: boolean) => void): () => void;
  session(topic: string): WalletSession | undefined;
  stop(): void;
}
