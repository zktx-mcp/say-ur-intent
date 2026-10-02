import { z } from "zod";
import { suiAddressStringSchema } from "../suiAddress.js";
import { SUI_MAINNET_WALLET_CHAIN, walletRunIdSchema, walletStartStageSchema, type WalletAvailability, type WalletSession, type WalletTransport, type WalletUnavailableReason } from "./walletConnection.js";

export { walletRunIdSchema, walletStartStageSchema } from "./walletConnection.js";
export type WalletStartStage = z.infer<typeof walletStartStageSchema>;
export const walletSessionSchema = z.object({
  topic: z.string().min(1), accounts: z.array(suiAddressStringSchema).min(1), methods: z.array(z.string()),
  chain: z.literal(SUI_MAINNET_WALLET_CHAIN), expiresAt: z.string().datetime(), walletName: z.string().optional()
}).strict();
export const walletSessionObservationSchema = z.discriminatedUnion("status", [
  z.object({ topic: z.string().min(1), version: z.number().int().positive(), status: z.literal("present"), session: walletSessionSchema }).strict(),
  z.object({ topic: z.string().min(1), version: z.number().int().positive(), status: z.enum(["absent", "unusable"]) }).strict()
]);
export type WalletSessionObservation = z.infer<typeof walletSessionObservationSchema>;
export const walletObservationSchema = z.object({
  runId: walletRunIdSchema, sequence: z.number().int().positive(), observedAt: z.string().datetime()
}).strict();
export const walletSnapshotSchema = walletObservationSchema.extend({ sessions: z.array(walletSessionObservationSchema) }).strict();
export type WalletSnapshot = z.infer<typeof walletSnapshotSchema>;
export type WalletObservation = z.infer<typeof walletObservationSchema>;

const recoveryBase = z.object({ kind: z.literal("wallet_service_recovery"), priorRunId: walletRunIdSchema,
  admittedAt: z.string().datetime(), updatedAt: z.string().datetime() });
export const walletRecoverySchema = z.union([
  recoveryBase.extend({ phase: z.literal("stopping") }).strict(),
  recoveryBase.extend({ phase: z.literal("starting"), nextRunId: walletRunIdSchema }).strict(),
  recoveryBase.extend({ outcome: z.enum(["available", "failed", "superseded", "server_restarted"]),
    nextRunId: walletRunIdSchema.optional(), message: z.string().optional() }).strict()
]);
export type WalletRecovery = z.infer<typeof walletRecoverySchema>;
// Private identity for one admitted recovery, not another source of its state.
export type WalletRecoveryTarget = { cardId: string; priorRunId: string; nextRunId?: string };
export const walletRecoveryImpactSchema = z.object({ connectionIds: z.array(z.string()), attemptIds: z.array(z.string()) }).strict();
export type WalletRecoveryImpact = z.infer<typeof walletRecoveryImpactSchema>;

export class WalletRunInterruptedError extends Error {
  constructor(readonly runId: string) { super("The wallet service run ended. This operation will not be repeated."); }
}
export class WalletReplacementFailedError extends Error {
  constructor(readonly runId: string) { super("The wallet service restart could not be confirmed."); }
}
export type WalletRuntimeEvent =
  | { type: "stage"; runId: string; stage: WalletStartStage }
  | { type: "snapshot"; runId: string; snapshot: WalletSnapshot; previous?: WalletSnapshot; ready: boolean }
  | { type: "lost"; runId: string; reason: WalletUnavailableReason }
  | { type: "exit"; runId: string };

// One captured SDK run. Methods never retarget themselves after recovery.
export interface WalletRun {
  readonly runId: string;
  assertCurrent(): void;
  connect(operationId: string): ReturnType<WalletTransport["connect"]>;
  disconnect(topic: string, operationId: string): Promise<void>;
  checkSession(topic: string, operationId: string): Promise<WalletSessionObservation>;
  sign(input: { topic: string; account: string; transactionBytesBase64: string; sessionVersion: number }, operationId: string): Promise<{
    transactionBytes: string; signature: string; sessionVersion: number;
  }>;
}

export interface WalletRuntime {
  readonly runId: string;
  availability(): WalletAvailability;
  snapshot(): WalletSnapshot | undefined;
  synchronize(): void;
  start(listener: (event: WalletRuntimeEvent) => void): void;
  bind(): WalletRun;
  publishReady(runId: string): void;
  fence(runId: string): void;
  block(reason: WalletUnavailableReason): void;
  replace(runId: string, beforeStart: (nextRunId: string) => void): Promise<void>;
  fail(reason: WalletUnavailableReason): void;
  dataReplaced(): void;
  close(): Promise<void>;
}

// Low-level SDK inspection distinguishes invalid/expired sessions from a
// successful lookup proving absence. Source errors must be thrown.
export type WalletSessionInspection = { topic: string; status: "present"; session: WalletSession } |
  { topic: string; status: "absent" | "unusable" };
