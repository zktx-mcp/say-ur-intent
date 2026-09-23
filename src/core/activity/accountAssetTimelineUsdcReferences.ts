import type { DeepbookOfficialIndexerCandle } from "../read/deepbookOfficialIndexerSource.js";
import {
  deepbookUsdcPriceHistoryQuantitySemantics,
  deepbookUsdcPriceHistoryResponseSummary
} from "../read/deepbookReadHelpers.js";
import {
  DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE,
  DEEPBOOK_OFFICIAL_INDEXER_USDC_REFERENCE
} from "../read/deepbookSourceOwners.js";
import {
  DEEPBOOK_USDC_PRICE_HISTORY_UNSUPPORTED_CLAIMS,
  type DeepbookUsdcPriceHistoryInput,
  type DeepbookUsdcPriceHistorySummary
} from "../read/readServiceTypes.js";
import type {
  AccountAssetTimelineNetFlowBar,
  AccountAssetTimelineResult
} from "./accountAssetTimeline.js";

export type AccountAssetTimelineUsdcPriceHistoryReader = (
  input: DeepbookUsdcPriceHistoryInput
) => Promise<DeepbookUsdcPriceHistorySummary>;

export type AccountAssetTimelineWithUsdcReferences = AccountAssetTimelineResult & {
  usdcReferences: AccountAssetTimelineUsdcReferenceSummary;
};

export type AccountAssetTimelineUsdcReferenceSummary = {
  status:
    | "available"
    | "partial"
    | "unavailable"
    | "no_timeline_bars";
  quoteAsset: typeof DEEPBOOK_OFFICIAL_INDEXER_USDC_REFERENCE.quoteAsset;
  priceConvention: typeof DEEPBOOK_OFFICIAL_INDEXER_USDC_REFERENCE.priceConvention;
  usdcIsFiatUsd: typeof DEEPBOOK_OFFICIAL_INDEXER_USDC_REFERENCE.usdcIsFiatUsd;
  usdPegGuaranteeAvailable: typeof DEEPBOOK_OFFICIAL_INDEXER_USDC_REFERENCE.usdPegGuaranteeAvailable;
  source: typeof DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE.kind;
  chainRecomputedBySayUrIntent: typeof DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE.chainRecomputedBySayUrIntent;
  quantitySemantics: ReturnType<typeof deepbookUsdcPriceHistoryQuantitySemantics>;
  responseSummary: ReturnType<typeof deepbookUsdcPriceHistoryResponseSummary>;
  unsupportedClaims: typeof DEEPBOOK_USDC_PRICE_HISTORY_UNSUPPORTED_CLAIMS[number][];
  coinReferences: AccountAssetTimelineCoinUsdcReference[];
};

export type AccountAssetTimelineCoinUsdcReference =
  | {
      coinType: string;
      status: "available" | "partial";
      pair: Extract<DeepbookUsdcPriceHistorySummary, { status: "ok" }>["pair"];
      candleAvailability: Extract<DeepbookUsdcPriceHistorySummary, { status: "ok" }>["candleAvailability"];
      source: Extract<DeepbookUsdcPriceHistorySummary, { status: "ok" }>["source"];
      barReferences: AccountAssetTimelineUsdcBarReference[];
    }
  | {
      coinType: string;
      status: "unsupported_asset";
      reason: Extract<DeepbookUsdcPriceHistorySummary, { status: "unsupported_pair" }>["reason"];
      matchingPoolNames: string[];
      availablePoolNames: string[];
    }
  | {
      coinType: string;
      status: "unsupported_range";
      reason: Extract<DeepbookUsdcPriceHistorySummary, { status: "unsupported_range" }>["reason"];
      requested: Extract<DeepbookUsdcPriceHistorySummary, { status: "unsupported_range" }>["requested"];
    }
  | {
      coinType: string;
      status: "source_unavailable";
      reason: Extract<DeepbookUsdcPriceHistorySummary, { status: "source_unavailable" }>["reason"];
      pair?: Extract<DeepbookUsdcPriceHistorySummary, { status: "source_unavailable" }>["pair"] | undefined;
      source?: Extract<DeepbookUsdcPriceHistorySummary, { status: "source_unavailable" }>["source"] | undefined;
    };

export type AccountAssetTimelineUsdcBarReference =
  | {
      bucketStart: string;
      bucketEnd: string;
      status: "available";
      candle: DeepbookOfficialIndexerCandle;
    }
  | {
      bucketStart: string;
      bucketEnd: string;
      status: "missing_candle";
    };

export async function attachDeepbookUsdcReferencesToTimeline(input: {
  timeline: AccountAssetTimelineResult;
  getPriceHistory: AccountAssetTimelineUsdcPriceHistoryReader;
}): Promise<AccountAssetTimelineWithUsdcReferences> {
  const baseSummary = emptyReferenceSummary();
  if (input.timeline.netFlowBars.length === 0) {
    return {
      ...input.timeline,
      usdcReferences: { ...baseSummary, status: "no_timeline_bars" }
    };
  }
  const barsByCoin = groupBarsByCoin(input.timeline.netFlowBars);
  const coinReferences: AccountAssetTimelineCoinUsdcReference[] = [];
  for (const [coinType, bars] of barsByCoin) {
    const history = await input.getPriceHistory({
      coinType,
      interval: input.timeline.bucket.interval,
      start: input.timeline.requestedRange.from,
      end: input.timeline.requestedRange.to
    });
    coinReferences.push(referenceForHistory(coinType, bars, history));
  }

  return {
    ...input.timeline,
    usdcReferences: {
      ...baseSummary,
      status: referenceSummaryStatus(coinReferences),
      coinReferences
    }
  };
}

function emptyReferenceSummary(): AccountAssetTimelineUsdcReferenceSummary {
  return {
    status: "unavailable",
    ...DEEPBOOK_OFFICIAL_INDEXER_USDC_REFERENCE,
    source: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE.kind,
    chainRecomputedBySayUrIntent: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE.chainRecomputedBySayUrIntent,
    quantitySemantics: deepbookUsdcPriceHistoryQuantitySemantics(),
    responseSummary: deepbookUsdcPriceHistoryResponseSummary(),
    unsupportedClaims: [...DEEPBOOK_USDC_PRICE_HISTORY_UNSUPPORTED_CLAIMS],
    coinReferences: []
  };
}

function referenceForHistory(
  coinType: string,
  timelineBars: AccountAssetTimelineNetFlowBar[],
  history: DeepbookUsdcPriceHistorySummary
): AccountAssetTimelineCoinUsdcReference {
  if (history.status === "unsupported_pair") {
    return {
      coinType,
      status: "unsupported_asset",
      reason: history.reason,
      matchingPoolNames: history.matchingPoolNames,
      availablePoolNames: history.availablePoolNames
    };
  }
  if (history.status === "unsupported_range") {
    return {
      coinType,
      status: "unsupported_range",
      reason: history.reason,
      requested: history.requested
    };
  }
  if (history.status === "source_unavailable") {
    return {
      coinType,
      status: "source_unavailable",
      reason: history.reason,
      pair: history.pair,
      source: history.source
    };
  }

  const candlesByBucket = new Map(history.bars.map((bar) => [`${bar.start}\n${bar.end}`, bar]));
  const barReferences: AccountAssetTimelineUsdcBarReference[] = timelineBars.map((bar) => {
    const candle = candlesByBucket.get(`${bar.bucketStart}\n${bar.bucketEnd}`);
    return candle === undefined
      ? {
          bucketStart: bar.bucketStart,
          bucketEnd: bar.bucketEnd,
          status: "missing_candle"
        }
      : {
          bucketStart: bar.bucketStart,
          bucketEnd: bar.bucketEnd,
          status: "available",
          candle
        };
  });
  return {
    coinType,
    status: barReferences.some((bar) => bar.status === "missing_candle")
      ? "partial"
      : "available",
    pair: history.pair,
    candleAvailability: history.candleAvailability,
    source: history.source,
    barReferences
  };
}

function groupBarsByCoin(bars: AccountAssetTimelineNetFlowBar[]): Map<string, AccountAssetTimelineNetFlowBar[]> {
  const result = new Map<string, AccountAssetTimelineNetFlowBar[]>();
  for (const bar of bars) {
    const existing = result.get(bar.coinType) ?? [];
    existing.push(bar);
    result.set(bar.coinType, existing);
  }
  return result;
}

function referenceSummaryStatus(coinReferences: AccountAssetTimelineCoinUsdcReference[]): AccountAssetTimelineUsdcReferenceSummary["status"] {
  if (coinReferences.length === 0) {
    return "no_timeline_bars";
  }
  const availableCount = coinReferences.filter((entry) => entry.status === "available").length;
  const partialCount = coinReferences.filter((entry) => entry.status === "partial").length;
  if (availableCount === coinReferences.length) {
    return "available";
  }
  if (availableCount > 0 || partialCount > 0) {
    return "partial";
  }
  return "unavailable";
}
