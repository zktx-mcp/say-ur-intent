import { describe, expect, it } from "vitest";
import {
  DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE,
  DEEPBOOK_OFFICIAL_INDEXER_CANDLE_TIMESTAMP_BOUNDARY,
  DEEPBOOK_OFFICIAL_INDEXER_INTERVALS,
  DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT,
  DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_BASE_URL,
  DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_INTERVAL,
  DeepbookOfficialIndexerSource,
  DeepbookOfficialIndexerSourceError,
  deepbookOfficialIndexerIntervalDurationMs,
  isDeepbookOfficialIndexerCanonicalUsdcPool,
  normalizeDeepbookOfficialIndexerBaseUrl,
  parseDeepbookOfficialIndexerInterval
} from "../src/core/read/deepbookOfficialIndexerSource.js";

const fetchedAt = new Date("2026-06-27T00:00:00.000Z");
const suiCandleTimestampMs = 1_782_541_800_000;

describe("DeepbookOfficialIndexerSource", () => {
  it("fetches and validates official pool entries without a status endpoint", async () => {
    const requestedUrls: string[] = [];
    const source = new DeepbookOfficialIndexerSource({
      fetch: async (url) => {
        requestedUrls.push(String(url));
        return jsonResponse(publicPoolsFixture());
      },
      now: () => fetchedAt
    });

    const result = await source.fetchPools();

    expect(requestedUrls).toEqual([`${DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_BASE_URL}/get_pools`]);
    expect(requestedUrls.some((url) => url.endsWith("/status"))).toBe(false);
    expect(result.source).toEqual({
      baseUrl: DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_BASE_URL,
      endpoint: "get_pools",
      url: `${DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_BASE_URL}/get_pools`,
      fetchedAt: fetchedAt.toISOString(),
      sourceStatement: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT
    });
    expect(result.pools.map((pool) => pool.pool_name)).toEqual(["NS_SUI", "DEEP_USDC", "SUI_USDC"]);
    expect(result.pools.filter(isDeepbookOfficialIndexerCanonicalUsdcPool).map((pool) => pool.pool_name)).toEqual([
      "DEEP_USDC",
      "SUI_USDC"
    ]);
    expect(result.pools.find((pool) => pool.pool_name === "SUI_USDC")).toMatchObject({
      quote_asset_id: DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE,
      quote_asset_symbol: "USDC"
    });
  });

  it("fetches official ohclv candles, sorts oldest-first, and records open-boundary timestamps", async () => {
    const requestedUrls: string[] = [];
    const source = new DeepbookOfficialIndexerSource({
      fetch: async (url) => {
        requestedUrls.push(String(url));
        return jsonResponse(publicSuiCandlesFixture());
      },
      now: () => fetchedAt
    });

    const result = await source.fetchCandles({
      poolName: "SUI_USDC",
      interval: DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_INTERVAL,
      startTimeMs: suiCandleTimestampMs,
      endTimeMs: suiCandleTimestampMs + deepbookOfficialIndexerIntervalDurationMs("15m") - 1,
      limit: 3
    });

    expect(requestedUrls).toEqual([
      `${DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_BASE_URL}/ohclv/SUI_USDC?interval=15m&start_time=1782541800000&end_time=1782542699999&limit=3`
    ]);
    expect(DEEPBOOK_OFFICIAL_INDEXER_CANDLE_TIMESTAMP_BOUNDARY).toBe("open");
    expect(result.source).toEqual({
      baseUrl: DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_BASE_URL,
      endpoint: "ohclv",
      url: requestedUrls[0],
      fetchedAt: fetchedAt.toISOString(),
      sourceStatement: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT,
      poolName: "SUI_USDC",
      interval: "15m",
      startTimeMs: suiCandleTimestampMs,
      endTimeMs: suiCandleTimestampMs + deepbookOfficialIndexerIntervalDurationMs("15m") - 1,
      limit: 3
    });
    expect(result.candles.map((candle) => candle.timestampMs)).toEqual([
      1_782_540_000_000,
      1_782_540_900_000,
      1_782_541_800_000
    ]);
    expect(result.candles[2]).toEqual({
      timestampMs: 1_782_541_800_000,
      start: "2026-06-27T06:30:00.000Z",
      end: "2026-06-27T06:45:00.000Z",
      open: "0.71174",
      high: "0.71427",
      low: "0.71158",
      close: "0.71404",
      volume: "59357.2"
    });
  });

  it("uses the official interval enum and rejects unsupported intervals", () => {
    expect(DEEPBOOK_OFFICIAL_INDEXER_INTERVALS).toEqual(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);
    expect(parseDeepbookOfficialIndexerInterval("15m")).toBe("15m");
    expect(parseDeepbookOfficialIndexerInterval("1w")).toBe("1w");
    expect(() => parseDeepbookOfficialIndexerInterval("not-an-interval")).toThrow("interval is not supported");
  });

  it("normalizes exponent notation to ordinary decimal strings", async () => {
    const source = new DeepbookOfficialIndexerSource({
      fetch: async () => jsonResponse({
        candles: [[suiCandleTimestampMs, 1e-7, 2e-7, 1e-7, 1.5e-7, 1e3]]
      })
    });

    const result = await source.fetchCandles({
      poolName: "SUI_USDC",
      interval: "15m"
    });

    expect(result.candles[0]).toMatchObject({
      open: "0.0000001",
      high: "0.0000002",
      low: "0.0000001",
      close: "0.00000015",
      volume: "1000"
    });
    expect(Object.values(result.candles[0]!).every((value) => typeof value !== "string" || !/[eE]/.test(value))).toBe(
      true
    );
  });

  it("fails the whole candle response on invalid candle payloads", async () => {
    const invalidHigh = new DeepbookOfficialIndexerSource({
      fetch: async () => jsonResponse({
        candles: [
          [suiCandleTimestampMs, 2, 3, 1, 2, 100],
          [suiCandleTimestampMs + deepbookOfficialIndexerIntervalDurationMs("15m"), 2, 1, 1, 2, 100]
        ]
      })
    });
    await expect(invalidHigh.fetchCandles({ poolName: "SUI_USDC", interval: "15m" })).rejects.toMatchObject({
      reason: "invalid_payload"
    } satisfies Partial<DeepbookOfficialIndexerSourceError>);

    const duplicateTimestamp = new DeepbookOfficialIndexerSource({
      fetch: async () => jsonResponse({
        candles: [
          [suiCandleTimestampMs, 1, 2, 1, 2, 100],
          [suiCandleTimestampMs, 1, 2, 1, 2, 100]
        ]
      })
    });
    await expect(duplicateTimestamp.fetchCandles({ poolName: "SUI_USDC", interval: "15m" })).rejects.toMatchObject({
      reason: "invalid_payload"
    } satisfies Partial<DeepbookOfficialIndexerSourceError>);
  });

  it("accepts additive official pool fields but fails closed on invalid consumed pool fields", async () => {
    const additiveSource = new DeepbookOfficialIndexerSource({
      fetch: async () => jsonResponse([
        {
          ...publicPoolsFixture()[0],
          enabled: true,
          min_size: "not consumed by Sui MCP"
        }
      ])
    });

    await expect(additiveSource.fetchPools()).resolves.toMatchObject({
      pools: [
        {
          pool_name: "NS_SUI",
          quote_asset_symbol: "SUI"
        }
      ]
    });

    const invalidSource = new DeepbookOfficialIndexerSource({
      fetch: async () => jsonResponse([
        {
          ...publicPoolsFixture()[0],
          quote_asset_id: "not-a-coin-type"
        }
      ])
    });

    await expect(invalidSource.fetchPools()).rejects.toMatchObject({
      reason: "invalid_payload"
    } satisfies Partial<DeepbookOfficialIndexerSourceError>);
  });

  it("reports source errors for timeout unavailable http errors and invalid base URLs", async () => {
    const timeoutSource = new DeepbookOfficialIndexerSource({
      fetch: async () => {
        throw new DOMException("aborted", "AbortError");
      }
    });
    await expect(timeoutSource.fetchPools()).rejects.toMatchObject({
      reason: "source_timeout"
    } satisfies Partial<DeepbookOfficialIndexerSourceError>);

    const unavailableSource = new DeepbookOfficialIndexerSource({
      fetch: async () => {
        throw new Error("dns");
      }
    });
    await expect(unavailableSource.fetchPools()).rejects.toMatchObject({
      reason: "source_unavailable"
    } satisfies Partial<DeepbookOfficialIndexerSourceError>);

    const httpSource = new DeepbookOfficialIndexerSource({
      fetch: async () => new Response("bad", { status: 500 })
    });
    await expect(httpSource.fetchPools()).rejects.toMatchObject({
      reason: "source_http_error",
      details: { httpStatus: 500 }
    } satisfies Partial<DeepbookOfficialIndexerSourceError>);

    expect(() => normalizeDeepbookOfficialIndexerBaseUrl("http://example.com/indexer")).toThrow("must use https");
    expect(() => normalizeDeepbookOfficialIndexerBaseUrl("https://example.com/indexer?x=1")).toThrow(
      "must not include credentials"
    );
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function publicPoolsFixture() {
  return [
    {
      pool_id: "0x27c4fdb3b846aa3ae4a65ef5127a309aa3c1f466671471a806d8912a18b253e8",
      pool_name: "NS_SUI",
      base_asset_id: "0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS",
      base_asset_decimals: 6,
      base_asset_symbol: "NS",
      base_asset_name: "NS Token",
      quote_asset_id: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
      quote_asset_decimals: 9,
      quote_asset_symbol: "SUI",
      quote_asset_name: "Sui",
      min_size: 1_000_000,
      lot_size: 100_000,
      tick_size: 10_000_000
    },
    {
      pool_id: "0xf948981b806057580f91622417534f491da5f61aeaf33d0ed8e69fd5691c95ce",
      pool_name: "DEEP_USDC",
      base_asset_id: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
      base_asset_decimals: 6,
      base_asset_symbol: "DEEP",
      base_asset_name: "DeepBook Token",
      quote_asset_id: DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE,
      quote_asset_decimals: 6,
      quote_asset_symbol: "USDC",
      quote_asset_name: "Native USDC Token",
      min_size: 10_000_000,
      lot_size: 1_000_000,
      tick_size: 10_000
    },
    {
      pool_id: "0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407",
      pool_name: "SUI_USDC",
      base_asset_id: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
      base_asset_decimals: 9,
      base_asset_symbol: "SUI",
      base_asset_name: "Sui",
      quote_asset_id: DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE,
      quote_asset_decimals: 6,
      quote_asset_symbol: "USDC",
      quote_asset_name: "Native USDC Token",
      min_size: 1_000_000_000,
      lot_size: 100_000_000,
      tick_size: 100
    }
  ];
}

function publicSuiCandlesFixture() {
  return {
    candles: [
      [1_782_541_800_000, 0.71174, 0.71427, 0.71158, 0.71404, 59357.2],
      [1_782_540_900_000, 0.70989, 0.71192, 0.70942, 0.7116, 181873.7],
      [1_782_540_000_000, 0.71471, 0.71549, 0.7099, 0.71008, 145793.2]
    ]
  };
}
