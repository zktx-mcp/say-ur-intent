import { TOOL_NAMES } from "../mcp/toolNames.js";
import { z } from "zod";
import { receiptDisplaySchema, walletDisplaySchema } from "../core/session/cardSession.js";

export { cardKindSchema, cardSnapshotSchema } from "../core/session/cardSession.js";
export type { CardKind, CardSnapshot, CardReference, CardSubmission } from "../core/session/cardSession.js";
export const CARD_RESOURCE_URIS = {
  account: "ui://say-ur-intent/account.html",
  receipt: "ui://say-ur-intent/receipt.html",
  chart: "ui://say-ur-intent/chart.html",
  connect: "ui://say-ur-intent/connect.html",
  review: "ui://say-ur-intent/review.html"
} as const;
export const CARD_METADATA_KEY = "say-ur-intent/card";
export const CARD_DISPLAY_METADATA_KEY = "say-ur-intent/receipt-display";
export const WALLET_DISPLAY_METADATA_KEY = "say-ur-intent/wallet-display";
export const CARD_RESOURCE_PREFIX = "sayurintent://cards/";
export const cardInputRequiredSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account"), status: z.literal("input_required"), field: z.literal("account"), message: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("receipt"), status: z.literal("input_required"), field: z.literal("digest"), message: z.string().min(1) }).strict()
]);
export const cardReferenceSchema = z.object({ cardId: z.string().min(1), permission: z.string().min(1) }).strict();
export const cardSubmissionSchema = cardReferenceSchema.extend({
  revision: z.number().int().nonnegative(), input: z.record(z.string(), z.unknown())
}).strict();
export const cardReceiptDisplaySchema = receiptDisplaySchema.extend({
  cardId: z.string().min(1), revision: z.number().int().nonnegative(), attemptId: z.string().min(1).optional()
});
export type CardReceiptDisplay = z.infer<typeof cardReceiptDisplaySchema>;
export const cardWalletDisplaySchema = walletDisplaySchema.extend({ cardId: z.string().min(1), revision: z.number().int().nonnegative() });
export type CardWalletDisplay = z.infer<typeof cardWalletDisplaySchema>;
export const CARD_TOOLS = {
  account: TOOL_NAMES.uiOpenAccount, receipt: TOOL_NAMES.uiOpenReceipt, chart: TOOL_NAMES.uiOpenChart,
  read: TOOL_NAMES.uiReadCard, submit: TOOL_NAMES.uiSubmitCard, act: TOOL_NAMES.uiActCard
} as const;
