import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEEPBOOK_ANSWER_USE,
  DEEPBOOK_OFFICIAL_INDEXER_CANDLE_USE,
  DEEPBOOK_OFFICIAL_INDEXER_RESPONSE_TEXT,
  DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE,
  DEEPBOOK_SDK_SIMULATION_SOURCE_BASE,
  DEEPBOOK_PINNED_SDK_METADATA_SOURCE,
  DEEPBOOK_READ_RESPONSE_UNSUPPORTED,
  DEEPBOOK_SOURCE_FIELD_VALUES,
  DEEPBOOK_SOURCE_OWNER_GROUPS,
  DEEPBOOK_SOURCE_OWNER_RUNTIME_WORDING
} from "../src/core/read/deepbookSourceOwners.js";
import { DEEPBOOK_SCALAR_UNIT_SOURCE } from "../src/core/read/coinMetadata.js";
import {
  deepbookAccountInventoryUserAnswerUse,
  deepbookMidPriceUserAnswerUse,
  deepbookOrderbookUserAnswerUse,
  deepbookQuoteUserAnswerUse,
  deepbookUsdcPriceAtTimeUserAnswerUse,
  deepbookUsdcPriceHistoryUserAnswerUse
} from "../src/core/read/readResponseGuidance.js";

describe("DeepBook source owner contract", () => {
  it("names every current DeepBook source owner group without owning FlowX", () => {
    expect(Object.keys(DEEPBOOK_SOURCE_OWNER_GROUPS).sort()).toEqual([
      "directSuiGrpcAndLocalMaterial",
      "guidanceOnly",
      "localTransactionActivity",
      "officialIndexerRest",
      "pinnedSdkMetadata",
      "sdkSimulation"
    ]);
    expect(DEEPBOOK_SOURCE_OWNER_GROUPS.officialIndexerRest.owns).toEqual(
      expect.arrayContaining(["USDC-quoted candle history", "chart candles"])
    );
    expect(JSON.stringify(DEEPBOOK_SOURCE_OWNER_GROUPS)).not.toMatch(/FlowX/i);
  });

  it("owns runtime source field literals and reusable source fragments", () => {
    expect(DEEPBOOK_SOURCE_FIELD_VALUES).toEqual({
      officialIndexer: "deepbook_v3_official_indexer",
      sdkMainnetPackageId: "deepbook_v3_sdk_mainnet_package_id",
      pinnedSdkWhenTargetAssetSelected: "pinned_deepbook_sdk_when_target_asset_selected"
    });
    expect(DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE).toEqual({
      kind: DEEPBOOK_SOURCE_FIELD_VALUES.officialIndexer,
      chainRecomputedBySuiMcp: false
    });
    expect(DEEPBOOK_OFFICIAL_INDEXER_CANDLE_USE).toMatchObject({
      allowedUse: DEEPBOOK_ANSWER_USE.officialUsdcCandleHistory,
      source: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE.kind,
      quoteAsset: "USDC",
      priceConvention: "USDC_PER_BASE",
      usdcIsFiatUsd: false,
      usdPegGuaranteeAvailable: false,
      chainRecomputedBySuiMcp: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE.chainRecomputedBySuiMcp
    });
    expect(DEEPBOOK_SDK_SIMULATION_SOURCE_BASE).toEqual({
      sdk: "@mysten/deepbook-v3",
      transport: "grpc",
      simulation: "client.core.simulateTransaction"
    });
    expect(DEEPBOOK_PINNED_SDK_METADATA_SOURCE.unitSource).toBe(DEEPBOOK_SCALAR_UNIT_SOURCE);
    expect(DEEPBOOK_OFFICIAL_INDEXER_RESPONSE_TEXT.usdcDisclaimer).toContain(
      DEEPBOOK_SOURCE_OWNER_RUNTIME_WORDING.usdcNotFiatUsdAndNotPeg
    );
    const source = readFileSync(join(process.cwd(), "src/core/read/deepbookSourceOwners.ts"), "utf8");
    expect(source).toContain("deepbook_v3_official_indexer");
    expect(source).toContain("deepbook_v3_sdk_mainnet_package_id");
    expect(source).toContain("pinned_deepbook_sdk_when_target_asset_selected");
  });

  it("feeds official candle answer-use labels into read-response guidance", () => {
    expect(deepbookUsdcPriceHistoryUserAnswerUse().canAnswer).toEqual([
      DEEPBOOK_ANSWER_USE.officialUsdcCandleHistory,
      DEEPBOOK_ANSWER_USE.officialCandleAvailabilityForRequestedUtcRange
    ]);
    expect(deepbookUsdcPriceAtTimeUserAnswerUse(true).canAnswer).toEqual([
      DEEPBOOK_ANSWER_USE.officialUsdcCandleForRequestedTime,
      DEEPBOOK_ANSWER_USE.representativeClosePriceForMatchedCandle
    ]);
    expect(deepbookUsdcPriceAtTimeUserAnswerUse(false).canAnswer).toEqual([
      DEEPBOOK_ANSWER_USE.officialUsdcCandleForRequestedTime
    ]);
  });

  it("feeds unsupported-use rules into DeepBook read-response guidance", () => {
    expect(deepbookOrderbookUserAnswerUse().cannotAnswer).toEqual([
      ...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.orderbook
    ]);
    expect(deepbookMidPriceUserAnswerUse().cannotAnswer).toEqual([
      ...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.midPrice
    ]);
    expect(deepbookUsdcPriceHistoryUserAnswerUse().cannotAnswer).toEqual([
      ...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.officialUsdcCandles
    ]);
    expect(deepbookUsdcPriceAtTimeUserAnswerUse(true).cannotAnswer).toEqual([
      ...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.officialUsdcCandles
    ]);
    expect(deepbookQuoteUserAnswerUse("raw").cannotAnswer).toEqual([
      ...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.quote
    ]);
    expect(deepbookAccountInventoryUserAnswerUse("available").cannotAnswer).toEqual(
      expect.arrayContaining([...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.accountInventory])
    );
  });
});
