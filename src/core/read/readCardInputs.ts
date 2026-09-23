import { z } from "zod";
import { suiAddressStringSchema, suiTransactionDigestSchema } from "../suiAddress.js";
import { DEEPBOOK_OFFICIAL_INDEXER_INTERVALS, DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_INTERVAL } from "./deepbookOfficialIndexerSource.js";
import { DEEPBOOK_USDC_CHART_DEFAULT_LIMIT, DEEPBOOK_USDC_CHART_MAX_CANDLES } from "./deepbookUsdcChartService.js";
import type { CardKind } from "../session/cardSession.js";
export const accountInputSchema = z.object({ account: suiAddressStringSchema }).strict();
export const receiptInputSchema = z.object({ digest: suiTransactionDigestSchema }).strict();
const chartInputBaseSchema = z.object({
  poolName: z.string().min(1),
  interval: z.enum(DEEPBOOK_OFFICIAL_INDEXER_INTERVALS).default(DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_INTERVAL),
  startTimeMs: z.number().int().nonnegative().optional(),
  endTimeMs: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(DEEPBOOK_USDC_CHART_MAX_CANDLES).default(DEEPBOOK_USDC_CHART_DEFAULT_LIMIT)
}).strict();
const validWindow = (value: { startTimeMs?: number | undefined; endTimeMs?: number | undefined }) =>
  value.startTimeMs === undefined || value.endTimeMs === undefined || value.startTimeMs < value.endTimeMs;
export const chartInputSchema = chartInputBaseSchema.refine(validWindow, "Start must precede end.");
export const chartOpenInputSchema = chartInputBaseSchema.partial().refine(validWindow, "Start must precede end.");
export function parseCardInput(kind: CardKind, input: unknown): Record<string, unknown> {
  return kind === "account" ? accountInputSchema.parse(input) : kind === "receipt" ? receiptInputSchema.parse(input) : chartInputSchema.parse(input);
}
