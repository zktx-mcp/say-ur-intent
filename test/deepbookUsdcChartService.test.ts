import { describe, expect, it } from "vitest";
import {
  DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE,
  DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT,
  DeepbookOfficialIndexerSourceError,
  type DeepbookOfficialIndexerCandle,
  type DeepbookOfficialIndexerCandlesInput,
  type DeepbookOfficialIndexerFetchSource,
  type DeepbookOfficialIndexerPool,
  type DeepbookOfficialIndexerSourceClient
} from "../src/core/read/deepbookOfficialIndexerSource.js";
import { DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE } from "../src/core/read/deepbookSourceOwners.js";
import {
  createDeepbookUsdcChartService,
  type DeepbookUsdcChartResult,
  type DeepbookUsdcChartPoolsResponse,
  DEEPBOOK_USDC_CHART_DEFAULT_LIMIT,
  DEEPBOOK_USDC_CHART_MAX_CANDLES
} from "../src/core/read/deepbookUsdcChartService.js";

const fetchedAt = "2026-06-27T00:00:00.000Z";
const baseUrl = "https://deepbook-indexer.mainnet.mystenlabs.com";
const suiPoolId = `0x${"1".repeat(64)}`;
const deepPoolId = `0x${"2".repeat(64)}`;
const nonUsdcPoolId = `0x${"3".repeat(64)}`;
const suiCoinType = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
const deepCoinType = `0x${"4".repeat(64)}::deep::DEEP`;

describe("DeepBook USDC chart service", () => {
  it("lists official USDC-quoted pools with source metadata and disclaimers", async () => {
    const api = createDeepbookUsdcChartService({ source: fakeSource(), now: () => new Date(fetchedAt) });

    const result = await api.getPools();
    expect(result).toMatchObject({
      status: "ok",
      poolCount: 2,
      responseSummary: {
        sourceStatement: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT,
        usdcDisclaimer: expect.stringContaining("not fiat USD")
      },
      quantitySemantics: {
        source: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_BASE.kind,
        usdcIsFiatUsd: false,
        chainRecomputedBySayUrIntent: false
      },
      unsupportedClaims: expect.arrayContaining(["fiat_usd_cash_out", "profit_or_pnl", "signing_readiness"]),
      source: {
        endpoint: "get_pools",
        url: `${baseUrl}/get_pools`
      }
    });
    if (result.status !== "ok") {
      throw new Error("expected pools ok");
    }
    const body = result as Extract<DeepbookUsdcChartPoolsResponse, { status: "ok" }>;
    expect(body.pools.map((pool) => pool.poolName)).toEqual(["SUI_USDC", "DEEP_USDC"]);
    expect(body.pools[0]).toMatchObject({
      poolName: "SUI_USDC",
      poolId: suiPoolId,
      baseAsset: { symbol: "SUI", coinType: suiCoinType, decimals: 9 },
      quoteAsset: {
        symbol: "USDC",
        coinType: DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE,
        decimals: 6
      },
      priceConvention: "USDC_PER_BASE"
    });
  });

  it("rejects query fields on the pool listing API", async () => {
    const api = createDeepbookUsdcChartService({ source: fakeSource() });

    await expectStatus(api.getPools(new URLSearchParams("poolName=SUI_USDC")), {
      status: "unsupported_input",
      reason: "unsupported_query_field",
      field: "poolName"
    });
  });

  it("returns latest candles with default interval and limit", async () => {
    const calls: DeepbookOfficialIndexerCandlesInput[] = [];
    const api = createDeepbookUsdcChartService({
      source: fakeSource({ onFetchCandles: (input) => calls.push(input) })
    });

    const result = await api.getCandles(new URLSearchParams("poolName=SUI_USDC"));
    expect(result).toMatchObject({
      status: "ok",
      query: {
        poolName: "SUI_USDC",
        interval: "15m",
        limit: DEEPBOOK_USDC_CHART_DEFAULT_LIMIT
      },
      pair: {
        poolName: "SUI_USDC",
        priceConvention: "USDC_PER_BASE"
      },
      candleCount: 2,
      source: {
        endpoint: "ohclv",
        poolName: "SUI_USDC",
        interval: "15m",
        limit: DEEPBOOK_USDC_CHART_DEFAULT_LIMIT
      }
    });
    expect(calls).toEqual([{ poolName: "SUI_USDC", interval: "15m", limit: 500 }]);
  });

  it("passes a timestamp window through to the official source", async () => {
    const calls: DeepbookOfficialIndexerCandlesInput[] = [];
    const api = createDeepbookUsdcChartService({
      source: fakeSource({ onFetchCandles: (input) => calls.push(input) })
    });

    const result = await api.getCandles(new URLSearchParams(
      "poolName=SUI_USDC&interval=1h&startTimeMs=1782541800000&endTimeMs=1782545400000&limit=3"
    ));
    expect(result.status).toBe("ok");
    expect(calls).toEqual([
      {
        poolName: "SUI_USDC",
        interval: "1h",
        startTimeMs: 1_782_541_800_000,
        endTimeMs: 1_782_545_400_000,
        limit: 3
      }
    ]);
  });

  it("rejects unsupported query fields intervals timestamp windows and over-limit requests", async () => {
    const api = createDeepbookUsdcChartService({ source: fakeSource() });

    await expectStatus(api.getCandles(new URLSearchParams("poolName=SUI_USDC&shortcut=Latest%20500")), {
      status: "unsupported_input",
      reason: "unsupported_query_field",
      field: "shortcut"
    });
    await expectStatus(api.getCandles(new URLSearchParams("poolName=SUI_USDC&poolName=DEEP_USDC")), {
      status: "unsupported_input",
      reason: "duplicate_query_field",
      field: "poolName"
    });
    await expectStatus(api.getCandles(new URLSearchParams("poolName=SUI_USDC&interval=not-an-interval")), {
      status: "unsupported_input",
      reason: "unsupported_interval",
      field: "interval"
    });
    await expectStatus(
      api.getCandles(new URLSearchParams("poolName=SUI_USDC&startTimeMs=200&endTimeMs=100")),
      {
        status: "unsupported_input",
        reason: "invalid_timestamp_window"
      }
    );
    await expectStatus(api.getCandles(new URLSearchParams("poolName=SUI_USDC&limit=10001")), {
      status: "over_limit",
      reason: "limit_exceeds_chart_cap",
      maxCandles: DEEPBOOK_USDC_CHART_MAX_CANDLES,
      requestedLimit: 10_001
    });
    await expectStatus(api.getCandles(new URLSearchParams("poolName=SUI_USDC&limit=0")), {
      status: "unsupported_input",
      reason: "invalid_limit",
      field: "limit"
    });
  });

  it("returns unsupported pool responses without fetching candles", async () => {
    let candleFetches = 0;
    const api = createDeepbookUsdcChartService({
      source: fakeSource({ onFetchCandles: () => { candleFetches += 1; } })
    });

    const result = await api.getCandles(new URLSearchParams("poolName=NS_SUI"));
    expect(result).toMatchObject({
      status: "unsupported_pool",
      reason: "pool_not_in_official_usdc_pools",
      availablePoolNames: ["SUI_USDC", "DEEP_USDC"]
    });
    expect(candleFetches).toBe(0);
  });

  it("returns empty-result responses without synthesizing candles", async () => {
    const api = createDeepbookUsdcChartService({ source: fakeSource({ candles: [] }) });

    const result = await api.getCandles(new URLSearchParams("poolName=SUI_USDC"));
    expect(result).toMatchObject({
      status: "empty_result",
      candleCount: 0,
      candles: []
    });
  });

  it("maps source errors to visible source-unavailable responses", async () => {
    const poolFailure = createDeepbookUsdcChartService({
      source: fakeSource({
        fetchPoolsError: new DeepbookOfficialIndexerSourceError("invalid_payload", "bad pools")
      })
    });
    await expectStatus(await poolFailure.getPools(), {
      status: "source_unavailable",
      reason: "official_indexer_invalid_payload"
    });

    const candleFailure = createDeepbookUsdcChartService({
      source: fakeSource({
        fetchCandlesError: new DeepbookOfficialIndexerSourceError("source_timeout", "slow candles")
      })
    });
    await expectStatus(candleFailure.getCandles(new URLSearchParams("poolName=SUI_USDC")), {
      status: "source_unavailable",
      reason: "source_timeout",
      query: {
        poolName: "SUI_USDC",
        interval: "15m",
        limit: 500
      }
    });
  });

  it("caches schema-validated pool and candle source results within the process TTL", async () => {
    let current = new Date("2026-06-27T00:00:00.000Z");
    let poolFetches = 0;
    let candleFetches = 0;
    const api = createDeepbookUsdcChartService({
      source: fakeSource({
        onFetchPools: () => { poolFetches += 1; },
        onFetchCandles: () => { candleFetches += 1; }
      }),
      now: () => current,
      cacheTtlMs: 60_000
    });

    await api.getPools();
    await api.getPools();
    await api.getCandles(new URLSearchParams("poolName=SUI_USDC&limit=2"));
    await api.getCandles(new URLSearchParams("poolName=SUI_USDC&limit=2"));
    expect(poolFetches).toBe(1);
    expect(candleFetches).toBe(1);

    current = new Date("2026-06-27T00:02:00.000Z");
    await api.getPools();
    await api.getCandles(new URLSearchParams("poolName=SUI_USDC&limit=2"));
    expect(poolFetches).toBe(2);
    expect(candleFetches).toBe(2);
  });
});

async function expectStatus(
  resultOrPromise: Promise<DeepbookUsdcChartResult> | DeepbookUsdcChartResult,
  body: Record<string, unknown>
) {
  const result = await resultOrPromise;
  expect(result).toMatchObject(body);
}

function fakeSource(options: {
  candles?: DeepbookOfficialIndexerCandle[] | undefined;
  fetchPoolsError?: Error | undefined;
  fetchCandlesError?: Error | undefined;
  onFetchPools?: (() => void) | undefined;
  onFetchCandles?: ((input: DeepbookOfficialIndexerCandlesInput) => void) | undefined;
} = {}): DeepbookOfficialIndexerSourceClient {
  return {
    async fetchPools() {
      options.onFetchPools?.();
      if (options.fetchPoolsError) {
        throw options.fetchPoolsError;
      }
      return {
        source: sourceMetadata("get_pools", `${baseUrl}/get_pools`),
        pools: officialPools()
      };
    },
    async fetchCandles(input) {
      options.onFetchCandles?.(input);
      if (options.fetchCandlesError) {
        throw options.fetchCandlesError;
      }
      return {
        source: sourceMetadata(
          "ohclv",
          `${baseUrl}/ohclv/${input.poolName}?interval=${input.interval}`,
          input
        ),
        candles: options.candles ?? officialCandles()
      };
    }
  };
}

function sourceMetadata(
  endpoint: DeepbookOfficialIndexerFetchSource["endpoint"],
  url: string,
  input: Partial<{
    poolName: string;
    interval: "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";
    limit: number | undefined;
    startTimeMs: number | undefined;
    endTimeMs: number | undefined;
  }> = {}
): DeepbookOfficialIndexerFetchSource {
  return {
    baseUrl,
    endpoint,
    url,
    fetchedAt,
    sourceStatement: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT,
    ...input
  };
}

function officialPools(): DeepbookOfficialIndexerPool[] {
  return [
    {
      pool_id: suiPoolId,
      pool_name: "SUI_USDC",
      base_asset_id: suiCoinType,
      base_asset_symbol: "SUI",
      base_asset_decimals: 9,
      quote_asset_id: DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE,
      quote_asset_symbol: "USDC",
      quote_asset_decimals: 6
    },
    {
      pool_id: deepPoolId,
      pool_name: "DEEP_USDC",
      base_asset_id: deepCoinType,
      base_asset_symbol: "DEEP",
      base_asset_decimals: 6,
      quote_asset_id: DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE,
      quote_asset_symbol: "USDC",
      quote_asset_decimals: 6
    },
    {
      pool_id: nonUsdcPoolId,
      pool_name: "NS_SUI",
      base_asset_id: `0x${"5".repeat(64)}::ns::NS`,
      base_asset_symbol: "NS",
      base_asset_decimals: 6,
      quote_asset_id: suiCoinType,
      quote_asset_symbol: "SUI",
      quote_asset_decimals: 9
    }
  ];
}

function officialCandles(): DeepbookOfficialIndexerCandle[] {
  return [
    {
      timestampMs: 1_782_541_800_000,
      start: "2026-06-27T06:30:00.000Z",
      end: "2026-06-27T06:45:00.000Z",
      open: "0.71174",
      high: "0.71427",
      low: "0.71158",
      close: "0.71404",
      volume: "59357.2"
    },
    {
      timestampMs: 1_782_542_700_000,
      start: "2026-06-27T06:45:00.000Z",
      end: "2026-06-27T07:00:00.000Z",
      open: "0.71404",
      high: "0.71412",
      low: "0.71291",
      close: "0.713",
      volume: "22650.5"
    }
  ];
}
