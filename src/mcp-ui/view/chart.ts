import { z } from "zod";
import { createChart, CandlestickSeries, HistogramSeries, type CandlestickData, type HistogramData, type UTCTimestamp, type WhitespaceData } from "lightweight-charts";
import { element, link } from "../../../review-app/src/ui/ui.js";
import { t } from "../../../review-app/src/i18n/i18n.js";
import type { CardRenderer } from "./lifecycle.js";

const candleSchema = z.object({ start: z.string(), timestampMs: z.number().int(),
  open: z.string(), high: z.string(), low: z.string(), close: z.string(), volume: z.string() });
type ChartCandle = z.infer<typeof candleSchema>;
export const DEEPBOOK_USDC_CHART_SHORTCUTS = ["Latest 500", "Last 24h", "Last 7d", "Last 30d"] as const;
export type DeepbookUsdcChartShortcut = (typeof DEEPBOOK_USDC_CHART_SHORTCUTS)[number];
const poolsSchema = z.object({ status: z.literal("ok"), pools: z.array(z.object({ poolName: z.string(),
  baseAsset: z.object({ symbol: z.string() }) })), intervals: z.array(z.string()), defaultInterval: z.string(), defaultLimit: z.number().int().positive(), maxCandles: z.number().int().positive() });
export const chartResultSchema = z.object({ status: z.enum(["ok", "empty_result"]), candles: z.array(candleSchema), candleCount: z.number().int().nonnegative(),
  query: z.object({ poolName: z.string(), interval: z.string(),
    startTimeMs: z.number().int().nonnegative().optional(), endTimeMs: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive() }), source: z.object({ fetchedAt: z.string() }),
  pair: z.object({ baseAsset: z.object({ symbol: z.string() }), quoteAsset: z.object({ symbol: z.literal("USDC") }) }) })
  .refine((value) => value.candleCount === value.candles.length, "Candle count differs from returned rows.");

function labelled(label: string, control: HTMLElement): HTMLLabelElement {
  const node = document.createElement("label"); node.append(document.createTextNode(label), control); return node;
}
export const chartRenderer = {
  title: "DeepBook USDC chart",
  controls(snapshot, submit) {
    const choices = poolsSchema.parse(snapshot.data);
    const form = document.createElement("form");
    const pool = document.createElement("select"); pool.required = true;
    pool.append(new Option("Choose a pair", ""));
    for (const item of choices.pools) pool.append(new Option(`${item.baseAsset.symbol} / USDC`, item.poolName));
    const interval = document.createElement("select");
    for (const value of choices.intervals) interval.append(new Option(value, value));
    interval.value = typeof snapshot.input.interval === "string" ? snapshot.input.interval : choices.defaultInterval;
    const start = document.createElement("input"); start.placeholder = "YYYY-MM-DDTHH:mm";
    const end = document.createElement("input"); end.placeholder = "YYYY-MM-DDTHH:mm";
    if (typeof snapshot.input.startTimeMs === "number") start.value = utcMsToInputValue(snapshot.input.startTimeMs);
    if (typeof snapshot.input.endTimeMs === "number") end.value = utcMsToInputValue(snapshot.input.endTimeMs);
    let candleLimit = Number(snapshot.input.limit ?? choices.defaultLimit);
    const ranges = element("div", "card-actions");
    for (const shortcut of DEEPBOOK_USDC_CHART_SHORTCUTS) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = shortcut === "Latest 500" ? "Recent" : shortcut;
      button.addEventListener("click", () => { const range = shortcutQuery(shortcut, new Date()); start.value = range.startInput; end.value = range.endInput; candleLimit = Number(range.limitInput); });
      ranges.append(button);
    }
    const button = document.createElement("button"); button.type = "submit"; button.textContent = "Show chart";
    const error = element("p", "ui-error"); error.setAttribute("role", "alert");
    form.append(labelled("Pair", pool), labelled("Interval", interval), labelled("Start (UTC)", start), labelled("End (UTC)", end), ranges, button, error);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const startTimeMs = parseUtcInputToMs(start.value), endTimeMs = parseUtcInputToMs(end.value);
        if (startTimeMs !== undefined && endTimeMs !== undefined && startTimeMs >= endTimeMs) throw new Error("Start must precede end.");
        submit({ poolName: pool.value, interval: interval.value, limit: candleLimit,
          ...(startTimeMs === undefined ? {} : { startTimeMs }), ...(endTimeMs === undefined ? {} : { endTimeMs }) });
      } catch (issue) { error.textContent = issue instanceof Error ? issue.message : "Invalid chart input."; }
    });
    return form;
  },
  result(snapshot) {
    const parsed = chartResultSchema.safeParse(snapshot.data);
    if (!parsed.success) {
      const data = snapshot.data as { status?: unknown; reason?: unknown } | undefined;
      if (data?.status === "source_unavailable" || data?.status === "unsupported_input" || data?.status === "unsupported_pool" || data?.status === "over_limit") {
        return { node: element("p", "ui-note", `Chart unavailable: ${typeof data.reason === "string" ? data.reason : data.status}.`) };
      }
      throw new Error("Chart data is incomplete.");
    }
    const data = parsed.data;
    const node = element("div");
    node.append(
      element("p", "ui-note", `${data.pair.baseAsset.symbol} / USDC · ${data.query.interval} · Checked at: ${data.source.fetchedAt}`),
      element("p", "ui-note", chartQueryText(data.query))
    );
    if (data.candleCount >= data.query.limit) node.append(element("p", "ui-note", `This view is limited to ${data.query.limit} candles; the requested period may contain more.`));
    const boundary = element("p", "ui-note", `${t.chart.boundaryUsdc} ${t.chart.boundaryScope} ${t.chart.source}`);
    const attribution = link(t.chart.library, "https://www.tradingview.com/");
    attribution.target = "_blank"; attribution.rel = "noopener noreferrer";
    boundary.append(` ${t.chart.renderedWith} `, attribution, ".");
    if (data.candles.length === 0) { node.append(element("p", "ui-note", "No candles returned for this range."), boundary); return { node }; }
    const container = element("div", "card-chart"); const legend = element("p", "ui-note");
    const last = data.candles.at(-1)!;
    const describe = (candle: ChartCandle) => `${candle.start} UTC · O ${candle.open} H ${candle.high} L ${candle.low} C ${candle.close} · V ${candle.volume}`;
    legend.textContent = describe(last); node.append(legend, container);
    node.append(boundary);
    let chart: ReturnType<typeof createChart> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let themeObserver: MutationObserver | undefined;
    let resizeFrame: number | undefined;
    let mounted = false, disposed = false;
    let previousWidth = 0, previousHeight = 0;
    const theme = () => {
      const style = getComputedStyle(document.documentElement);
      const color = (name: string) => style.getPropertyValue(name).trim();
      chart?.applyOptions({ layout: { background: { color: color("--ui-surface") }, textColor: color("--ui-text") },
        grid: { vertLines: { color: color("--ui-border") }, horzLines: { color: color("--ui-border") } } });
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true; resizeObserver?.disconnect(); themeObserver?.disconnect(); chart?.remove();
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    };
    const resize = () => {
      if (disposed || !container.isConnected) return;
      const width = container.clientWidth, height = container.clientHeight;
      // A hidden or not-yet-laid-out frame must never set chart spacing to zero.
      // Keep the last positive size and viewport until the frame is visible.
      if (width <= 0 || height <= 0 || (width === previousWidth && height === previousHeight)) return;
      try {
        if (chart) chart.resize(width, height);
        else {
          // No pixel minimum: even the maximum candle count must fit the request.
          // Positive explicit dimensions make the resulting bar spacing positive.
          chart = createChart(container, { width, height, autoSize: false, layout: { attributionLogo: false },
            timeScale: { timeVisible: true, secondsVisible: false, minBarSpacing: 0, lockVisibleTimeRangeOnResize: true } });
          const series = chart.addSeries(CandlestickSeries, { upColor: "#167752", downColor: "#b44336", borderVisible: false,
            wickUpColor: "#167752", wickDownColor: "#b44336", priceFormat: { type: "price", precision: 6, minMove: 0.000001 } });
          const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" }, 1);
          const display = chartSeriesData(data.candles, data.query);
          series.setData(display.prices); volume.setData(display.volumes);
          chart.panes()[0]?.setStretchFactor(3); chart.panes()[1]?.setStretchFactor(1);
          if (display.range) chart.timeScale().setVisibleRange(display.range);
          else chart.timeScale().fitContent();
          const byTime = new Map(data.candles.map((candle) => [candleTime(candle), candle]));
          chart.subscribeCrosshairMove((event) => { legend.textContent = describe((typeof event.time === "number" ? byTime.get(event.time) : undefined) ?? last); });
          theme();
          themeObserver = new MutationObserver(theme);
          themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        }
        previousWidth = width; previousHeight = height;
      } catch {
        dispose();
        container.replaceChildren(element("p", "ui-error", "The chart could not be displayed. The saved query and source data are unchanged."));
      }
    };
    return { node, mount: () => {
      if (mounted || disposed) return;
      mounted = true;
      // Own sizing instead of autoSize so later zero-size notifications cannot
      // corrupt a valid chart. Resize preserves the user's current time range.
      resizeObserver = new ResizeObserver(() => {
        if (disposed || resizeFrame !== undefined) return;
        // Draw after the observer delivery phase, not while size notifications
        // are being delivered to the chart's descendant canvases.
        resizeFrame = requestAnimationFrame(() => { resizeFrame = undefined; resize(); });
      });
      resizeObserver.observe(container);
      resize();
    }, dispose };
  }
} satisfies CardRenderer;

export function chartSeriesData(candles: ChartCandle[], query: z.infer<typeof chartResultSchema>["query"]) {
  const prices: (CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] = candles.map(candleToCandlestickData);
  const volumes: (HistogramData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] = candles.map(candleToVolumeData);
  const times = new Set(prices.map((point) => point.time));
  // Lightweight Charts clamps visible ranges to known time points. Whitespace
  // anchors preserve requested boundaries without inventing prices or volume.
  // They are display-only; the saved source candles remain unchanged.
  for (const boundary of [query.startTimeMs, query.endTimeMs]) {
    if (boundary === undefined) continue;
    const time = boundary / 1000 as UTCTimestamp;
    if (!times.has(time)) { prices.push({ time }); volumes.push({ time }); times.add(time); }
  }
  prices.sort((a, b) => a.time - b.time); volumes.sort((a, b) => a.time - b.time);
  const from = query.startTimeMs === undefined ? prices[0]?.time : query.startTimeMs / 1000 as UTCTimestamp;
  const to = query.endTimeMs === undefined ? prices.at(-1)?.time : query.endTimeMs / 1000 as UTCTimestamp;
  const hasBoundary = query.startTimeMs !== undefined || query.endTimeMs !== undefined;
  return { prices, volumes, range: hasBoundary && from !== undefined && to !== undefined && from < to ? { from, to } : undefined };
}

export function chartQueryText(query: z.infer<typeof chartResultSchema>["query"]): string {
  if (query.startTimeMs === undefined && query.endTimeMs === undefined) {
    return "Recent candles · UTC";
  }
  const utc = (timestamp: number | undefined): string => {
    if (timestamp === undefined) return "not specified";
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
      ? `${timestamp} milliseconds since 1970-01-01T00:00:00Z`
      : date.toISOString();
  };
  return `Period (UTC): ${utc(query.startTimeMs)} → ${utc(query.endTimeMs)}`;
}

export function shortcutQuery(
  shortcut: DeepbookUsdcChartShortcut,
  now: Date
): { startInput: string; endInput: string; limitInput: string } {
  if (shortcut === "Latest 500") {
    return { startInput: "", endInput: "", limitInput: "500" };
  }
  const durationMs =
    shortcut === "Last 24h"
      ? 24 * 60 * 60 * 1000
      : shortcut === "Last 7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  const end = now.getTime();
  const start = end - durationMs;
  return { startInput: utcMsToInputValue(start), endInput: utcMsToInputValue(end), limitInput: "10000" };
}

export function parseUtcInputToMs(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    throw new Error("UTC timestamps must use YYYY-MM-DDTHH:mm.");
  }
  const ms = Date.parse(`${trimmed}:00.000Z`);
  if (!Number.isSafeInteger(ms)) {
    throw new Error("UTC timestamp is invalid.");
  }
  return ms;
}

export function utcMsToInputValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

export function candleToCandlestickData(candle: ChartCandle): CandlestickData<UTCTimestamp> {
  return {
    time: candleTime(candle) as UTCTimestamp,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close)
  };
}

export function candleToVolumeData(candle: ChartCandle): HistogramData<UTCTimestamp> {
  return {
    time: candleTime(candle) as UTCTimestamp,
    value: Number(candle.volume),
    color: Number(candle.close) >= Number(candle.open) ? "rgba(22, 119, 82, 0.45)" : "rgba(180, 67, 54, 0.45)"
  };
}

function candleTime(candle: ChartCandle): number {
  return Math.floor(candle.timestampMs / 1000);
}
