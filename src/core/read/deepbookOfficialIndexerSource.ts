import { z } from "zod";
import { normalizeCoinType } from "./coinMetadata.js";

export const DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_BASE_URL = "https://deepbook-indexer.mainnet.mystenlabs.com";
export const DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_FETCH_TIMEOUT_MS = 10_000;
export const DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
export const DEEPBOOK_OFFICIAL_INDEXER_PRICE_CONVENTION = "USDC_PER_BASE";
export const DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT =
  "Sui MCP read DeepBookV3 official Indexer candle data for this response.";
export const DEEPBOOK_OFFICIAL_INDEXER_CANDLE_TIMESTAMP_BOUNDARY = "open" as const;
export const DEEPBOOK_OFFICIAL_INDEXER_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
export const DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_INTERVAL = "15m" as const;

const SUI_OBJECT_ID_PATTERN = /^0x[0-9a-f]{64}$/i;
const DECIMAL_STRING_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export type DeepbookOfficialIndexerSourceErrorReason =
  | "invalid_source_url"
  | "source_unavailable"
  | "source_timeout"
  | "source_http_error"
  | "invalid_payload";

export class DeepbookOfficialIndexerSourceError extends Error {
  constructor(
    readonly reason: DeepbookOfficialIndexerSourceErrorReason,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const finiteNonNegativeNumberSchema = z.number().refine((value) => Number.isFinite(value) && value >= 0, {
  message: "expected a finite non-negative number"
});
const timestampMsSchema = z.number().int().refine((value) => Number.isSafeInteger(value) && value >= 0, {
  message: "expected a finite non-negative integer millisecond timestamp"
});
const decimalStringSchema = z.string().regex(DECIMAL_STRING_PATTERN);
const isoDateStringSchema = z.string().refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}, "expected an ISO timestamp string");
const coinTypeSchema = z.string().min(1).refine((value) => {
  try {
    normalizeCoinType(value);
    return true;
  } catch {
    return false;
  }
}, "expected a valid Sui coin type");

export const deepbookOfficialIndexerIntervalSchema = z.enum(DEEPBOOK_OFFICIAL_INDEXER_INTERVALS);
export type DeepbookOfficialIndexerInterval = z.infer<typeof deepbookOfficialIndexerIntervalSchema>;

export const deepbookOfficialIndexerPoolSchema = z.object({
  pool_id: z.string().regex(SUI_OBJECT_ID_PATTERN),
  pool_name: z.string().min(1),
  base_asset_id: coinTypeSchema,
  base_asset_symbol: z.string().min(1),
  base_asset_decimals: z.number().int().min(0).max(255),
  quote_asset_id: coinTypeSchema,
  quote_asset_symbol: z.string().min(1),
  quote_asset_decimals: z.number().int().min(0).max(255)
});

export const deepbookOfficialIndexerPoolsSchema = z.array(deepbookOfficialIndexerPoolSchema).min(1);
export type DeepbookOfficialIndexerPool = z.infer<typeof deepbookOfficialIndexerPoolSchema>;

const deepbookOfficialIndexerWireCandleSchema = z.tuple([
  timestampMsSchema,
  finiteNonNegativeNumberSchema,
  finiteNonNegativeNumberSchema,
  finiteNonNegativeNumberSchema,
  finiteNonNegativeNumberSchema,
  finiteNonNegativeNumberSchema
]).superRefine((candle, context) => {
  const [, open, high, low, close] = candle;
  if (high < open || high < low || high < close) {
    context.addIssue({
      code: "custom",
      message: "candle high must be greater than or equal to open low and close",
      path: [2]
    });
  }
  if (low > open || low > high || low > close) {
    context.addIssue({
      code: "custom",
      message: "candle low must be less than or equal to open high and close",
      path: [3]
    });
  }
});

export const deepbookOfficialIndexerOhclvResponseSchema = z.object({
  candles: z.array(deepbookOfficialIndexerWireCandleSchema)
}).superRefine((response, context) => {
  const seen = new Set<number>();
  for (const [index, candle] of response.candles.entries()) {
    const timestampMs = candle[0];
    if (seen.has(timestampMs)) {
      context.addIssue({
        code: "custom",
        message: "duplicate candle timestamp",
        path: ["candles", index, 0]
      });
      continue;
    }
    seen.add(timestampMs);
  }
});

export const deepbookOfficialIndexerCandleSchema = z.object({
  timestampMs: timestampMsSchema,
  start: isoDateStringSchema,
  end: isoDateStringSchema,
  open: decimalStringSchema,
  high: decimalStringSchema,
  low: decimalStringSchema,
  close: decimalStringSchema,
  volume: decimalStringSchema
}).strict().superRefine((candle, context) => {
  if (Date.parse(candle.end) <= Date.parse(candle.start)) {
    context.addIssue({ code: "custom", message: "candle end must be after start", path: ["end"] });
  }
});
export type DeepbookOfficialIndexerCandle = z.infer<typeof deepbookOfficialIndexerCandleSchema>;

export type DeepbookOfficialIndexerFetchSource = {
  baseUrl: string;
  endpoint: "get_pools" | "ohclv";
  url: string;
  fetchedAt: string;
  sourceStatement: typeof DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT;
  poolName?: string | undefined;
  interval?: DeepbookOfficialIndexerInterval | undefined;
  startTimeMs?: number | undefined;
  endTimeMs?: number | undefined;
  limit?: number | undefined;
};

export type DeepbookOfficialIndexerSourceOptions = {
  baseUrl?: string | undefined;
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
  now?: (() => Date) | undefined;
};

export type DeepbookOfficialIndexerCandlesInput = {
  poolName: string;
  interval: DeepbookOfficialIndexerInterval;
  startTimeMs?: number | undefined;
  endTimeMs?: number | undefined;
  limit?: number | undefined;
};

export type DeepbookOfficialIndexerPoolsResult = {
  source: DeepbookOfficialIndexerFetchSource;
  pools: DeepbookOfficialIndexerPool[];
};

export type DeepbookOfficialIndexerCandlesResult = {
  source: DeepbookOfficialIndexerFetchSource;
  candles: DeepbookOfficialIndexerCandle[];
};

export type DeepbookOfficialIndexerSourceClient = {
  fetchPools(): Promise<DeepbookOfficialIndexerPoolsResult>;
  fetchCandles(input: DeepbookOfficialIndexerCandlesInput): Promise<DeepbookOfficialIndexerCandlesResult>;
};

export class DeepbookOfficialIndexerSource implements DeepbookOfficialIndexerSourceClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: DeepbookOfficialIndexerSourceOptions = {}) {
    this.baseUrl = normalizeDeepbookOfficialIndexerBaseUrl(
      options.baseUrl ?? DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_BASE_URL
    );
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_FETCH_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  poolsUrl(): string {
    return new URL("get_pools", `${this.baseUrl}/`).toString();
  }

  candlesUrl(input: DeepbookOfficialIndexerCandlesInput): string {
    const interval = parseDeepbookOfficialIndexerInterval(input.interval);
    assertPoolName(input.poolName);
    const url = new URL(`ohclv/${encodeURIComponent(input.poolName)}`, `${this.baseUrl}/`);
    url.searchParams.set("interval", interval);
    if (input.startTimeMs !== undefined) {
      assertTimestampMs(input.startTimeMs, "startTimeMs");
      url.searchParams.set("start_time", input.startTimeMs.toString());
    }
    if (input.endTimeMs !== undefined) {
      assertTimestampMs(input.endTimeMs, "endTimeMs");
      url.searchParams.set("end_time", input.endTimeMs.toString());
    }
    if (input.limit !== undefined) {
      assertPositiveInteger(input.limit, "limit");
      url.searchParams.set("limit", input.limit.toString());
    }
    return url.toString();
  }

  async fetchPools(): Promise<DeepbookOfficialIndexerPoolsResult> {
    const response = await this.fetchJson("get_pools", this.poolsUrl());
    const pools = parseOfficialIndexerPayload(deepbookOfficialIndexerPoolsSchema, response.json, response.source);
    return { source: response.source, pools };
  }

  async fetchCandles(
    input: DeepbookOfficialIndexerCandlesInput
  ): Promise<DeepbookOfficialIndexerCandlesResult> {
    const interval = parseDeepbookOfficialIndexerInterval(input.interval);
    const url = this.candlesUrl({ ...input, interval });
    const response = await this.fetchJson("ohclv", url, { ...input, interval });
    const payload = parseOfficialIndexerPayload(deepbookOfficialIndexerOhclvResponseSchema, response.json, response.source);
    const candles = payload.candles
      .map((wireCandle) => officialWireCandleToCandle(wireCandle, interval))
      .sort((left, right) => left.timestampMs - right.timestampMs);
    return {
      source: response.source,
      candles
    };
  }

  private async fetchJson(
    endpoint: DeepbookOfficialIndexerFetchSource["endpoint"],
    url: string,
    input: Partial<DeepbookOfficialIndexerCandlesInput> = {}
  ): Promise<{ source: DeepbookOfficialIndexerFetchSource; json: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "sui-mcp"
        }
      });
    } catch (error) {
      throw officialIndexerFetchError(error, endpoint, url);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new DeepbookOfficialIndexerSourceError(
        "source_http_error",
        "DeepBook official Indexer source returned an error",
        {
          endpoint,
          url,
          httpStatus: response.status
        }
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new DeepbookOfficialIndexerSourceError(
        "invalid_payload",
        "DeepBook official Indexer source returned invalid JSON",
        {
          endpoint,
          url,
          message: error instanceof Error ? error.message : String(error)
        }
      );
    }

    return {
      source: {
        baseUrl: this.baseUrl,
        endpoint,
        url,
        fetchedAt: this.now().toISOString(),
        sourceStatement: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT,
        poolName: input.poolName,
        interval: input.interval,
        startTimeMs: input.startTimeMs,
        endTimeMs: input.endTimeMs,
        limit: input.limit
      },
      json
    };
  }
}

export function normalizeDeepbookOfficialIndexerBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DeepbookOfficialIndexerSourceError(
      "invalid_source_url",
      "DeepBook official Indexer base URL must be a valid URL"
    );
  }
  if (parsed.protocol !== "https:") {
    throw new DeepbookOfficialIndexerSourceError(
      "invalid_source_url",
      "DeepBook official Indexer base URL must use https"
    );
  }
  if (!parsed.hostname) {
    throw new DeepbookOfficialIndexerSourceError(
      "invalid_source_url",
      "DeepBook official Indexer base URL must include a host"
    );
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new DeepbookOfficialIndexerSourceError(
      "invalid_source_url",
      "DeepBook official Indexer base URL must not include credentials, query, or fragment"
    );
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

export function parseDeepbookOfficialIndexerInterval(value: string): DeepbookOfficialIndexerInterval {
  const parsed = deepbookOfficialIndexerIntervalSchema.safeParse(value);
  if (!parsed.success) {
    throw new DeepbookOfficialIndexerSourceError(
      "invalid_payload",
      "DeepBook official Indexer interval is not supported",
      { interval: value }
    );
  }
  return parsed.data;
}

export function deepbookOfficialIndexerIntervalDurationMs(interval: DeepbookOfficialIndexerInterval): number {
  switch (interval) {
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "30m":
      return 30 * 60_000;
    case "1h":
      return 60 * 60_000;
    case "4h":
      return 4 * 60 * 60_000;
    case "1d":
      return 24 * 60 * 60_000;
    case "1w":
      return 7 * 24 * 60 * 60_000;
  }
}

export function isDeepbookOfficialIndexerCanonicalUsdcPool(pool: DeepbookOfficialIndexerPool): boolean {
  return normalizeCoinType(pool.quote_asset_id) === normalizeCoinType(DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE);
}

export function selectDeepbookOfficialIndexerCanonicalUsdcPools(
  pools: DeepbookOfficialIndexerPool[]
): DeepbookOfficialIndexerPool[] {
  return pools.filter(isDeepbookOfficialIndexerCanonicalUsdcPool);
}

function officialWireCandleToCandle(
  [timestampMs, open, high, low, close, volume]: z.infer<typeof deepbookOfficialIndexerWireCandleSchema>,
  interval: DeepbookOfficialIndexerInterval
): DeepbookOfficialIndexerCandle {
  const start = new Date(timestampMs).toISOString();
  const end = new Date(timestampMs + deepbookOfficialIndexerIntervalDurationMs(interval)).toISOString();
  return deepbookOfficialIndexerCandleSchema.parse({
    timestampMs,
    start,
    end,
    open: decimalStringFromNumber(open),
    high: decimalStringFromNumber(high),
    low: decimalStringFromNumber(low),
    close: decimalStringFromNumber(close),
    volume: decimalStringFromNumber(volume)
  });
}

function decimalStringFromNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new DeepbookOfficialIndexerSourceError("invalid_payload", "DeepBook official Indexer number is invalid", {
      value
    });
  }
  const asString = value.toString();
  if (!/[eE]/.test(asString)) {
    return asString;
  }
  const [coefficient, exponentText] = asString.toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (coefficient === undefined || exponentText === undefined || !Number.isInteger(exponent)) {
    throw new DeepbookOfficialIndexerSourceError("invalid_payload", "DeepBook official Indexer number is invalid", {
      value
    });
  }
  const [rawIntegerPart, fractionalPart = ""] = coefficient.split(".");
  const integerPart = rawIntegerPart ?? "";
  const digits = `${integerPart}${fractionalPart}`;
  const decimalPosition = integerPart.length + exponent;
  let decimal: string;
  if (decimalPosition <= 0) {
    decimal = `0.${"0".repeat(-decimalPosition)}${digits}`;
  } else if (decimalPosition >= digits.length) {
    decimal = `${digits}${"0".repeat(decimalPosition - digits.length)}`;
  } else {
    decimal = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  }
  return normalizeDecimalString(decimal);
}

function normalizeDecimalString(value: string): string {
  const unsigned = value.replace(/^0+(?=\d)/, "");
  const trimmed = unsigned.includes(".") ? unsigned.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : unsigned;
  return trimmed === "" ? "0" : trimmed;
}

function parseOfficialIndexerPayload<T>(
  schema: z.ZodType<T>,
  json: unknown,
  source: DeepbookOfficialIndexerFetchSource
): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new DeepbookOfficialIndexerSourceError(
      "invalid_payload",
      "DeepBook official Indexer payload failed schema validation",
      {
        endpoint: source.endpoint,
        url: source.url,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      }
    );
  }
  return parsed.data;
}

function assertPoolName(poolName: string): void {
  if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(poolName)) {
    throw new DeepbookOfficialIndexerSourceError("invalid_payload", "DeepBook official Indexer pool name is invalid", {
      poolName
    });
  }
}

function assertTimestampMs(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DeepbookOfficialIndexerSourceError("invalid_payload", `DeepBook official Indexer ${field} is invalid`, {
      [field]: value
    });
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DeepbookOfficialIndexerSourceError("invalid_payload", `DeepBook official Indexer ${field} is invalid`, {
      [field]: value
    });
  }
}

function officialIndexerFetchError(error: unknown, endpoint: string, url: string): DeepbookOfficialIndexerSourceError {
  const message = error instanceof Error ? error.message : String(error);
  if (isAbortError(error)) {
    return new DeepbookOfficialIndexerSourceError("source_timeout", "DeepBook official Indexer source timed out", {
      endpoint,
      url,
      message
    });
  }
  return new DeepbookOfficialIndexerSourceError(
    "source_unavailable",
    "DeepBook official Indexer source could not be read",
    {
      endpoint,
      url,
      message
    }
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}
