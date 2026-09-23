import {
  SETTLEMENT_ASSET_GROUP_PARITY_QUANTITY_KIND,
  type SettlementAssetGroupParityAsset,
  type SettlementAssetGroupParityQuantitySemantics,
  type SettlementAssetGroupParityResponseSummary,
  type SettlementAssetGroupParitySummary
} from "./readServiceTypes.js";

export function settlementAssetGroupParityQuantitySemantics(): SettlementAssetGroupParityQuantitySemantics {
  return {
    kind: SETTLEMENT_ASSET_GROUP_PARITY_QUANTITY_KIND,
    allowedUse: "settlement_asset_group_internal_parity_evidence",
    referenceAssetRole: "measurement_reference_not_settlement_choice",
    priceSource: "deepbook_mid_price_snapshot",
    fiatUsdCashOutAvailable: false,
    externalMarketPriceConversionAvailable: false,
    externalMarketLookupAvailable: false,
    usdPegAssumptionAvailable: false,
    settlementTokenSelectionAvailable: false,
    paymentExecutionReadinessAvailable: false,
    routeRecommendationAvailable: false,
    profitAndLossAvailable: false,
    costBasisAvailable: false,
    notFor: [
      "settlement_token_selection",
      "fiat_usd_cash_out",
      "external_market_price_conversion",
      "external_market_lookup",
      "usd_peg_assumption",
      "bank_cash_out_estimate",
      "payment_execution_readiness",
      "route_recommendation",
      "best_route",
      "transaction_building",
      "signing_readiness",
      "profit_or_pnl",
      "cost_basis"
    ]
  };
}

export function settlementAssetGroupParityStatistics(
  samples: Extract<SettlementAssetGroupParityAsset, { status: "reference_asset" | "measured" }>[],
  unavailableAssetCount: number
): SettlementAssetGroupParitySummary["statistics"] {
  const sorted = [...samples].sort((left, right) => left.priceInReferenceAsset - right.priceInReferenceAsset);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]!.priceInReferenceAsset
      : (sorted[middle - 1]!.priceInReferenceAsset + sorted[middle]!.priceInReferenceAsset) / 2;
  const mean = samples.reduce((sum, sample) => sum + sample.priceInReferenceAsset, 0) / samples.length;
  return {
    status: "available",
    sampleCount: samples.length,
    unavailableAssetCount,
    parityDirection: "reference_asset_per_group_asset",
    calculation: "computed_from_available_direct_deepbook_mid_price_snapshots",
    min: { symbol: min.symbol, priceInReferenceAsset: roundPriceInReferenceAsset(min.priceInReferenceAsset) },
    max: { symbol: max.symbol, priceInReferenceAsset: roundPriceInReferenceAsset(max.priceInReferenceAsset) },
    mean: { priceInReferenceAsset: roundPriceInReferenceAsset(mean) },
    median: { priceInReferenceAsset: roundPriceInReferenceAsset(median) }
  };
}

export function settlementAssetGroupParityResponseSummary(input: {
  assetGroupId: SettlementAssetGroupParitySummary["assetGroupId"];
  referenceAssetSymbol: string;
  statistics: SettlementAssetGroupParitySummary["statistics"];
}): SettlementAssetGroupParityResponseSummary {
  return {
    questionKind: "settlement_asset_group_parity",
    conclusionKind: "parity_statistics_available",
    assetGroupId: input.assetGroupId,
    referenceAssetSymbol: input.referenceAssetSymbol,
    referenceAssetRole: "measurement_reference_not_settlement_choice",
    parityDirection: input.statistics.parityDirection,
    min: input.statistics.min,
    max: input.statistics.max,
    mean: input.statistics.mean,
    median: input.statistics.median,
    excludedFromConclusion: [
      "settlement_token_selection",
      "fiat_usd_cash_out",
      "payment_execution_readiness",
      "route_recommendation",
      "best_route",
      "transaction_building",
      "signing_readiness",
      "profit_or_pnl",
      "cost_basis"
    ]
  };
}

export function roundPriceInReferenceAsset(price: number): number {
  return Number(price.toFixed(9));
}
