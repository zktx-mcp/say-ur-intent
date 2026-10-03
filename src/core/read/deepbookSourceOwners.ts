import {
  DEEPBOOK_OFFICIAL_INDEXER_PRICE_CONVENTION,
  DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT
} from "./deepbookOfficialIndexerSource.js";
import { DEEPBOOK_SCALAR_UNIT_SOURCE } from "./coinMetadata.js";

export const DEEPBOOK_SOURCE_OWNER_GROUPS = {
  pinnedSdkMetadata: {
    label: "pinned DeepBook SDK metadata",
    owns: ["token metadata", "pool metadata", "scalar metadata", "symbol metadata", "package metadata"]
  },
  sdkSimulation: {
    label: "DeepBook SDK simulation through Sui gRPC",
    owns: ["orderbook snapshots", "mid-price snapshots", "raw quote evidence", "display quote evidence", "account inventory"]
  },
  directSuiGrpcAndLocalMaterial: {
    label: "direct Sui gRPC plus local material stores",
    owns: ["wallet balances", "object facts", "transaction material", "review-time simulation", "receipt reads"]
  },
  officialIndexerRest: {
    label: "DeepBookV3 official Indexer REST",
    owns: ["USDC-quoted candle history", "price-at-time candles", "chart candles", "account-timeline USDC candle references"]
  },
  localTransactionActivity: {
    label: "local SQLite transaction activity plus local protocol rules",
    owns: ["account net-flow bars", "protocolMatches"]
  },
  guidanceOnly: {
    label: "guidance and test enforcement only",
    owns: ["runtime source wording", "unsupported-use wording", "source-policy tests"]
  }
} as const;

export const DEEPBOOK_ANSWER_USE = {
  officialUsdcCandleHistory: "official_deepbook_usdc_candle_history",
  officialCandleAvailabilityForRequestedUtcRange: "official_candle_availability_for_the_requested_utc_range",
  officialUsdcCandleForRequestedTime: "official_deepbook_usdc_candle_for_requested_time",
  representativeClosePriceForMatchedCandle: "representative_close_price_for_the_matched_candle"
} as const;

export const DEEPBOOK_SOURCE_FIELD_VALUES = {
  officialIndexer: "deepbook_v3_official_indexer",
  sdkMainnetPackageId: "deepbook_v3_sdk_mainnet_package_id",
  pinnedSdkWhenTargetAssetSelected: "pinned_deepbook_sdk_when_target_asset_selected"
} as const;

export const DEEPBOOK_SDK_SIMULATION_SOURCE_BASE = {
  sdk: "@mysten/deepbook-v3",
  transport: "grpc",
  simulation: "client.core.simulateTransaction"
} as const;

export const DEEPBOOK_PINNED_SDK_METADATA_SOURCE = {
  sdk: "@mysten/deepbook-v3",
  registry: ["mainnetCoins", "mainnetPools"],
  network: "mainnet",
  unitSource: DEEPBOOK_SCALAR_UNIT_SOURCE
} as const;

export const DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE = {
  kind: DEEPBOOK_SOURCE_FIELD_VALUES.officialIndexer,
  chainRecomputedBySuiMcp: false
} as const;

export const DEEPBOOK_OFFICIAL_INDEXER_USDC_REFERENCE = {
  quoteAsset: "USDC",
  priceConvention: DEEPBOOK_OFFICIAL_INDEXER_PRICE_CONVENTION,
  usdcIsFiatUsd: false,
  usdPegGuaranteeAvailable: false
} as const;

export const DEEPBOOK_OFFICIAL_INDEXER_CANDLE_USE = {
  allowedUse: DEEPBOOK_ANSWER_USE.officialUsdcCandleHistory,
  source: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE.kind,
  ...DEEPBOOK_OFFICIAL_INDEXER_USDC_REFERENCE,
  chainRecomputedBySuiMcp: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE.chainRecomputedBySuiMcp
} as const;

export const DEEPBOOK_SOURCE_OWNER_RUNTIME_WORDING = {
  officialIndexerCandleData: "DeepBookV3 official Indexer candle data",
  officialIndexerCandleReferences: "DeepBookV3 official Indexer candle references",
  officialIndexerUsdcDenominatedCandles: "DeepBookV3 official Indexer USDC-denominated candles",
  pinnedSdkSnapshots: "pinned-SDK snapshots",
  usdcNotFiatUsdAndNotPeg: "not fiat USD and not a USDC/USD peg guarantee"
} as const;

export const DEEPBOOK_OFFICIAL_INDEXER_RESPONSE_TEXT = {
  sourceStatement: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT,
  usdcDisclaimer: `USDC is a token-denominated reference asset here, ${DEEPBOOK_SOURCE_OWNER_RUNTIME_WORDING.usdcNotFiatUsdAndNotPeg}.`
} as const;

export const DEEPBOOK_READ_RESPONSE_UNSUPPORTED = {
  orderbook: [
    "live_orderbook_stream",
    "global_market_price",
    "indicative_quote_for_a_source_amount",
    "payment_coverage_or_shortfall",
    "liquidity_verdict",
    "price_impact",
    "venue_comparison",
    "route_recommendation",
    "transaction_building",
    "signing_data_or_readiness",
    "profit_or_pnl"
  ],
  midPrice: [
    "global_market_price",
    "fiat_usd_cash_out",
    "external_market_price_conversion",
    "usd_peg_assumption",
    "payment_coverage_or_shortfall",
    "price_impact",
    "quote_slippage",
    "venue_comparison",
    "route_recommendation",
    "transaction_building",
    "signing_data_or_readiness",
    "profit_or_pnl",
    "cost_basis"
  ],
  officialUsdcCandles: [
    "fiat_usd_cash_out",
    "usd_peg_assumption",
    "global_market_price",
    "historical_mid_price",
    "live_quote",
    "route_recommendation",
    "best_route",
    "transaction_building",
    "signing_data_or_readiness",
    "profit_or_pnl",
    "cost_basis"
  ],
  quote: [
    "payment_coverage",
    "payment_shortfall",
    "funding_source",
    "route_dependent_payment_support",
    "final_min_out",
    "liquidity_verdict",
    "price_impact",
    "quote_vs_mid_slippage",
    "effective_price",
    "venue_comparison",
    "route_recommendation",
    "fiat_usd_cash_out",
    "external_market_price_conversion",
    "usd_peg_assumption",
    "transaction_building",
    "signing_data_or_readiness",
    "profit_or_pnl",
    "cost_basis"
  ],
  accountInventory: [
    "current_wallet_coin_balance",
    "wallet_transaction_history",
    "funding_source",
    "route_liquidity",
    "withdrawal_readiness",
    "payment_coverage_or_shortfall",
    "transaction_building",
    "signing_data_or_readiness",
    "profit_or_pnl",
    "cost_basis"
  ],
  protocolMatches: [
    "market_data",
    "route_support",
    "inventory_evidence",
    "signing_readiness",
    "official_indexer_replacement_evidence"
  ]
} as const;
