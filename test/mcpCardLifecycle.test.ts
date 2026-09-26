import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { registerReadCards } from "../src/mcp-ui/tools.js";
import { createReadCardStore } from "../src/mcp-ui/readCards.js";
import { SqliteActivityStore } from "../src/core/activity/sqliteActivityStore.js";
import { validateSupportedAdapterLifecycle } from "../src/adapters/adapterLifecycleValidators.js";
import { createDeepbookUsdcChartService } from "../src/core/read/deepbookUsdcChartService.js";
import { DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE, DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT } from "../src/core/read/deepbookOfficialIndexerSource.js";
import { chartRenderer } from "../src/mcp-ui/view/chart.js";
import { reviewRenderer } from "../src/mcp-ui/view/review.js";
import { workflowViewSchema, REVIEW_BOUNDARY, type WorkflowView } from "../src/core/session/workflowView.js";
import { connectRenderer } from "../src/mcp-ui/view/connect.js";
import { registerWalletConnectionTools } from "../src/mcp/tools/session/walletConnectionTools.js";
import type { McpServerDeps } from "../src/mcp/server.js";
import { walletWorkflowFixture, deferred } from "./fixtures/walletWorkflow.js";
import { TOOL_NAMES } from "../src/mcp/toolNames.js";
import { CARD_METADATA_KEY, CARD_TOOLS, type CardKind, type CardSnapshot } from "../src/mcp-ui/contracts.js";
import { startCard, type CardRenderer } from "../src/mcp-ui/view/lifecycle.js";

type Host = {
  connect: () => Promise<void>;
  getHostVersion: () => { name: string };
  getHostContext: () => { theme: string };
  callServerTool: ReturnType<typeof vi.fn<(request: { name: string; arguments: Record<string, unknown> }) => Promise<CallToolResult>>>;
  readServerResource: ReturnType<typeof vi.fn>;
  ontoolresult?: (result: CallToolResult) => void;
  onteardown?: () => Promise<object>;
  onhostcontextchanged?: (value: { theme: string }) => void;
};
const transport = vi.hoisted(() => ({ pending: [] as Host[] }));
vi.mock("@modelcontextprotocol/ext-apps", () => ({ App: class {
  constructor() { const app = transport.pending.shift(); if (!app) throw new Error("Missing prepared Host transport."); return app; }
} }));

// DOM primitives only; initialization, state handling, retries and timer cleanup
// all execute the real lifecycle module. Layout remains an actual Host check.
class Element extends EventTarget {
  children: Element[] = [];
  parent?: Element;
  ownText = "";
  className = "";
  classList = { add: (...names: string[]) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); } };
  disabled = false;
  dataset: Record<string, string> = {};
  value = "";
  readOnly = false;
  constructor(readonly tagName: string) { super(); }
  set textContent(text: string) { this.ownText = text; this.children = []; }
  get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  setAttribute(_name: string, _value: string): void {}
  append(...items: Array<Element | string>): void { for (const value of items) {
    const item = typeof value === "string" ? new Element("#text") : value;
    if (typeof value === "string") item.textContent = value;
    item.parent = this; this.children.push(item);
  } }
  prepend(...items: Element[]): void { for (const item of items) item.parent = this; this.children.unshift(...items); }
  replaceChildren(...items: Element[]): void { this.ownText = ""; this.children = []; this.append(...items); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  querySelectorAll(selector: string): Element[] {
    const tags = selector.split(",").map((value) => value.trim());
    return this.children.flatMap((child) => [...(tags.includes(child.tagName) ||
      (tags.includes("[data-card-action]") && child.dataset.cardAction !== undefined) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string): Element | undefined { return this.querySelectorAll(selector)[0]; }
  click(): void { if (!this.disabled) this.dispatchEvent(new Event("click")); }
  focus(): void {}
  select(): void {}
}
const instances: Host[] = [];
let root: Element;
function state(kind: CardKind, overrides: Partial<CardSnapshot> = {}): CardSnapshot {
  return { cardId: "fixture-card", kind, revision: 0, state: "ready", input: {},
    createdAt: "2026-09-22T00:00:00.000Z", expiresAt: "2026-09-22T00:30:00.000Z", pollAfterMs: 5000,
    inputRemainingMs: 1000, ...overrides };
}
function result(snapshot: CardSnapshot, permission = false): CallToolResult {
  return { content: [], structuredContent: { ok: true, data: snapshot },
    ...(permission ? { _meta: { [CARD_METADATA_KEY]: { cardId: snapshot.cardId, permission: "fixture-permission" } } } : {}) };
}
function host(handler: (request: { name: string; arguments: Record<string, unknown> }) => Promise<CallToolResult>, connect = Promise.resolve()): Host {
  const app: Host = { connect: () => connect, getHostVersion: () => ({ name: "Claude" }), getHostContext: () => ({ theme: "light" }),
    callServerTool: vi.fn(handler), readServerResource: vi.fn() };
  transport.pending.push(app); instances.push(app); return app;
}
const renderer: CardRenderer = {
  title: "Fixture card",
  controls(_snapshot, submit) {
    const form = document.createElement("form");
    const input = document.createElement("input"); input.value = "draft input";
    const button = document.createElement("button"); button.textContent = "Submit choice";
    button.addEventListener("click", () => submit({ account: `0x${"a".repeat(64)}` }));
    form.append(input, button); return form;
  },
  result() { const node = document.createElement("p"); node.textContent = "Stored result"; const toggle = document.createElement("button"); toggle.textContent = "Show details";
    toggle.addEventListener("click", () => { node.textContent = "Stored result details"; }); node.append(toggle); return { node }; }
};
const submitButton = () => root.querySelectorAll("button").find((node) => node.textContent === "Submit choice");

// Minimal business controls for timer/identity checks. Actual Review rendering
// is verified with the final HTML; the lifecycle and transport calls here are real.
const expiryRenderer: CardRenderer = {
  ...renderer,
  controls(snapshot) {
    const data = snapshot.data as { allowedActions: string[] };
    if (!data.allowedActions.includes("request_signature")) {
      const node = document.createElement("p"); node.textContent = "Update this review"; return node;
    }
    const form = document.createElement("form"), input = document.createElement("input"), button = document.createElement("button");
    input.value = "selected wallet"; button.dataset.cardAction = "request_signature"; button.textContent = "Request wallet approval";
    form.append(input, button); return form;
  }
};
const timedReview = (overrides: Record<string, unknown> = {}) => state("review", { data: {
  allowedActions: ["request_signature"], actionRemainingMs: 20_000, observe: false, nextStateReadAfterMs: 500, ...overrides
} });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  root = new Element("main");
  vi.stubGlobal("document", { getElementById: () => root, createElement: (tag: string) => new Element(tag),
    createTextNode: (text: string) => { const node = new Element("#text"); node.textContent = text; return node; }, documentElement: new Element("html") });
  vi.stubGlobal("Option", class extends Element {
    constructor(text: string, value: string) { super("option"); this.textContent = text; this.value = value; }
  });
  vi.stubGlobal("__SAY_UR_INTENT_VERSION__", "fixture");
});
afterEach(async () => {
  for (const app of instances.splice(0)) await app.onteardown?.();
  transport.pending.length = 0; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it("reads at the server's review expiry, locks input during confirmation and then offers refresh", async () => {
  const pending = deferred<CallToolResult>(), ready = timedReview();
  const app = host(async () => app.callServerTool.mock.calls.length === 1 ? result(ready) : pending.promise);
  const started = Date.now();
  startCard("review", expiryRenderer); app.ontoolresult!(result(ready, true));
  // Flush initialization without waitFor's implicit fake-clock advancement.
  await vi.advanceTimersByTimeAsync(0);
  expect(Date.now()).toBe(started); expect(root.querySelectorAll("button")[0]?.disabled).toBe(false);
  const button = root.querySelectorAll("button")[0]!;
  await vi.advanceTimersByTimeAsync(499); expect(app.callServerTool).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(button.disabled).toBe(true); expect(app.callServerTool).toHaveBeenCalledTimes(2);
  pending.resolve(result(state("review", { revision: 1, data: { allowedActions: ["prepare_review"], actionRemainingMs: 19_500, observe: false } })));
  await vi.waitFor(() => expect(root.textContent).toContain("Update this review"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(app.callServerTool.mock.calls.map(([call]) => call.name)).toEqual([CARD_TOOLS.read, CARD_TOOLS.read]);
});

it("coalesces expiry with a poll and retains input when only the next-read hint changes", async () => {
  const pending = deferred<CallToolResult>(), ready = { ...timedReview({ observe: true }), pollAfterMs: 500 };
  const app = host(async () => app.callServerTool.mock.calls.length === 1 ? result(ready) : pending.promise);
  startCard("review", expiryRenderer); app.ontoolresult!(result(ready, true));
  await vi.waitFor(() => expect(root.querySelectorAll("input")).toHaveLength(1));
  const input = root.querySelectorAll("input")[0]!; input.value = "user choice";
  await vi.advanceTimersByTimeAsync(500); expect(app.callServerTool).toHaveBeenCalledTimes(2);
  pending.resolve(result({ ...ready, data: { ...(ready.data as object), nextStateReadAfterMs: 900, actionRemainingMs: 19_500 } }));
  await vi.waitFor(() => expect(input.disabled).toBe(false));
  expect(root.querySelectorAll("input")[0]).toBe(input); expect(input.value).toBe("user choice");
  await app.onteardown!(); await vi.advanceTimersByTimeAsync(1000); expect(app.callServerTool).toHaveBeenCalledTimes(2);
});

it("stops after an expiry-read failure and does not loop on a zero refresh hint", async () => {
  const ready = timedReview(); const app = host(async () => {
    if (app.callServerTool.mock.calls.length === 1) return result(ready);
    throw new Error("Expiry confirmation unavailable");
  });
  startCard("review", expiryRenderer); app.ontoolresult!(result(ready, true));
  await vi.waitFor(() => expect(root.querySelectorAll("input")).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(500);
  expect(root.textContent).toContain("Expiry confirmation unavailable"); expect(root.querySelectorAll("input")[0]?.disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000); expect(app.callServerTool).toHaveBeenCalledTimes(2);
  await app.onteardown!(); root = new Element("main");
  const zero = timedReview({ nextStateReadAfterMs: 0 }); const reopened = host(async () => result(zero));
  startCard("review", expiryRenderer); reopened.ontoolresult!(result(zero, true));
  await vi.waitFor(() => expect(root.querySelectorAll("input")).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(500); expect(reopened.callServerTool).toHaveBeenCalledTimes(1);
});

describe("shared card lifecycle consumes backend state", () => {
  it.each(["account", "receipt", "chart"] as const)("%s tolerates event order, replay and a new frame without any opening/close operation", async (kind) => {
    let current = state(kind);
    let connect!: () => void;
    const connected = new Promise<void>((resolve) => { connect = resolve; });
    const app = host(async () => result(current), connected);
    startCard(kind, renderer);
    app.ontoolresult!(result(current, true)); app.ontoolresult!(result(current, true));
    expect(app.callServerTool).not.toHaveBeenCalled();
    connect();
    await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false));
    expect(app.callServerTool.mock.calls.map(([call]) => call.name)).toEqual([CARD_TOOLS.read]);
    await app.onteardown!();
    const next = host(async (request) => {
      if (request.name === CARD_TOOLS.submit) current = state(kind, { state: "closed", reason: "completed", revision: 2, inputRemainingMs: 0, data: { value: "saved" } });
      return result(current);
    });
    startCard(kind, renderer); await Promise.resolve(); next.ontoolresult!(result(current, true));
    await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false));
    submitButton()!.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Stored result"));
    next.ontoolresult!(result(state(kind), true));
    expect(submitButton()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(next.callServerTool.mock.calls.map(([call]) => call.name)).toEqual([CARD_TOOLS.read, CARD_TOOLS.submit]);
    const details = root.querySelectorAll("button").find((button) => button.textContent === "Show details");
    expect(details?.disabled).toBe(false); details!.click();
    expect(root.textContent).toContain("Stored result details");
    expect(root.querySelectorAll("button").some((button) => /copy/i.test(button.textContent))).toBe(false);
  });
  it("mounts result views only after insertion and disposes them on teardown", async () => {
    const completed = state("chart", { state: "closed", reason: "completed", revision: 2, inputRemainingMs: 0, data: { saved: true } });
    const node = document.createElement("div");
    const mount = vi.fn(() => {
      expect(root.querySelectorAll("section")[0]!.children).toContain(node);
    });
    const dispose = vi.fn();
    const app = host(async () => result(completed));
    startCard("chart", { ...renderer, result: () => ({ node, mount, dispose }) });
    app.ontoolresult!(result(completed, true));
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    app.ontoolresult!(result(completed, true));
    expect(mount).toHaveBeenCalledOnce();
    await app.onteardown!(); await app.onteardown!();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("uses server remaining time even when the local clock is years ahead, then consumes server expiry", async () => {
    const ready = state("account"); let reads = 0;
    const app = host(async () => result(++reads === 1 ? ready : state("account", { state: "closed", reason: "expired", revision: 1, inputRemainingMs: 0 })));
    startCard("account", renderer); app.ontoolresult!(result(ready, true));
    await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false));
    expect(reads).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(root.textContent).toContain("expired"); expect(submitButton()).toBeUndefined(); expect(reads).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000); expect(reads).toBe(2);
  });
  it("adopts an authenticated conflict response without another query", async () => {
    const ready = state("account");
    const app = host(async (request) => request.name === CARD_TOOLS.read ? result(ready) : {
      isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: { details: {
        code: "card_conflict", reason: "Another choice was accepted.", snapshot: state("account", { state: "closed", reason: "completed", revision: 2, data: { value: "other result" }, inputRemainingMs: 0 })
      } } }) }]
    });
    startCard("account", renderer); app.ontoolresult!(result(ready, true));
    await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false)); submitButton()!.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Another choice was accepted."));
    expect(root.textContent).toContain("Stored result"); expect(submitButton()).toBeUndefined();
    expect(app.callServerTool.mock.calls.map(([call]) => call.name)).toEqual([CARD_TOOLS.read, CARD_TOOLS.submit]);
  });
  it("preserves input display and stops timers after a typed evaluation conflict until an explicit read", async () => {
    const ready = state("account", { inputRemainingMs: 500 });
    let reads = 0;
    const app = host(async () => ++reads === 2 ? {
      isError: true, content: [], structuredContent: { ok: false, error: { kind: "invalid_session_transition",
        details: { reason: "review_changed_during_verification", message: "Review data changed during verification. Read the current state again." } } }
    } : result(ready));
    startCard("account", renderer); app.ontoolresult!(result(ready, true));
    await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false));
    await vi.advanceTimersByTimeAsync(500);
    expect(root.textContent).toContain("Read the current state again.");
    expect(root.textContent).not.toContain("review_changed_during_verification");
    expect(submitButton()?.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads).toBe(2);
    root.querySelectorAll("button").find((button) => button.textContent === "Read saved state")!.click();
    await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false));
    expect(reads).toBe(3);
    expect(app.callServerTool.mock.calls.every(([call]) => call.name === CARD_TOOLS.read)).toBe(true);
  });
  it("reads state after a lost submit response and never repeats the submission", async () => {
    const ready = state("account"); let reads = 0;
    const app = host(async (request) => {
      if (request.name === CARD_TOOLS.submit) throw new Error("Lost reply");
      return result(++reads === 1 ? ready : state("account", { state: "closed", reason: "completed", revision: 2, data: { value: "saved" }, inputRemainingMs: 0 }));
    });
    startCard("account", renderer); app.ontoolresult!(result(ready, true));
    await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false)); submitButton()!.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Stored result"));
    expect(app.callServerTool.mock.calls.map(([call]) => call.name)).toEqual([CARD_TOOLS.read, CARD_TOOLS.submit, CARD_TOOLS.read]);
  });
  it("ignores a late state reply after teardown and makes teardown idempotent", async () => {
    const ready = state("account");
    let resolve!: (value: CallToolResult) => void;
    const reply = new Promise<CallToolResult>((done) => { resolve = done; });
    const app = host(async () => reply);
    startCard("account", renderer); app.ontoolresult!(result(ready, true));
    await vi.waitFor(() => expect(app.callServerTool).toHaveBeenCalledOnce());
    await app.onteardown!(); await app.onteardown!();
    const before = root.textContent;
    resolve(result(state("account", { state: "closed", reason: "completed", revision: 2, data: { value: "late" }, inputRemainingMs: 0 })));
    await vi.advanceTimersByTimeAsync(0);
    expect(root.textContent).toBe(before);
    expect(submitButton()).toBeUndefined(); // No input is built before the first DB confirmation.
    expect(app.callServerTool).toHaveBeenCalledOnce();
  });
  it("does not enable inputs without metadata or after a failed state read", async () => {
    const ready = state("account");
    const missing = host(async () => { throw new Error("Must not call without permission"); });
    startCard("account", renderer); missing.ontoolresult!(result(ready));
    await vi.waitFor(() => expect(root.textContent).toContain("did not provide"));
    expect(submitButton()).toBeUndefined(); expect(missing.callServerTool).not.toHaveBeenCalled();
    const failing = host(async () => { throw new Error("State unavailable"); });
    startCard("account", renderer); failing.ontoolresult!(result(ready, true));
    await vi.waitFor(() => expect(root.textContent).toContain("State unavailable"));
    expect(submitButton()).toBeUndefined();
  });
});

it("confirms the DB once despite a failed creating preview and adopts the newer state", async () => {
  const preview = state("receipt", { state: "closed", reason: "completed", revision: 1, data: { old: true } });
  const current = state("receipt", { state: "closed", reason: "completed", revision: 2, data: { saved: true } });
  const render = vi.fn((value: CardSnapshot) => {
    if (value.revision === 1) throw new Error("fixture preview failure");
    return renderer.result(value);
  });
  const app = host(async () => result(current));
  startCard("receipt", { ...renderer, result: render });
  app.ontoolresult!(result(preview, true)); app.ontoolresult!(result(preview, true));
  await vi.waitFor(() => expect(root.textContent).toContain("Stored result"));
  expect(app.callServerTool.mock.calls.map(([call]) => call.name)).toEqual([CARD_TOOLS.read]);
  expect(render.mock.calls.map(([value]) => value.revision)).toEqual([1, 2]);
  expect(root.textContent).not.toContain("could not be displayed");
});

it.each(["result", "mount"] as const)("contains a %s failure after a known submit reply without rereading or enabling stale input", async (failure) => {
  const ready = state("receipt");
  const dispose = vi.fn();
  const app = host(async (request) => result(request.name === CARD_TOOLS.read ? ready : state("receipt", {
    state: "closed", reason: "completed", revision: 2, data: { saved: true }, inputRemainingMs: 0
  })));
  startCard("receipt", { ...renderer, result: () => {
    if (failure === "result") throw new Error("fixture result failure");
    return { node: document.createElement("p"), mount: () => { throw new Error("fixture mount failure"); }, dispose };
  } });
  app.ontoolresult!(result(ready, true));
  await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false));
  submitButton()!.click();
  await vi.waitFor(() => expect(root.textContent).toContain("could not be displayed"));
  expect(root.textContent).toContain("Saved result");
  expect(root.textContent).not.toContain("Request a new card");
  expect(submitButton()?.disabled).toBe(true);
  submitButton()!.click();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(app.callServerTool.mock.calls.map(([call]) => call.name)).toEqual([CARD_TOOLS.read, CARD_TOOLS.submit]);
  await app.onteardown!(); await app.onteardown!();
  expect(dispose).toHaveBeenCalledTimes(failure === "mount" ? 1 : 0);
});

it("retains a displayed result when mounting its private-detail replacement fails", async () => {
  const old = state("receipt", { state: "closed", reason: "completed", revision: 1, data: { old: true } });
  const current = state("receipt", { state: "closed", reason: "completed", revision: 2, data: { saved: true } });
  const oldDispose = vi.fn(), failedDispose = vi.fn();
  const app = host(async () => result(current));
  startCard("receipt", { ...renderer, result: (value) => value.revision === 1
    ? { ...renderer.result(value), dispose: oldDispose }
    : { node: document.createElement("p"), dispose: failedDispose, mount: () => { throw new Error("fixture mount failure"); } }
  });
  app.ontoolresult!(result(old, true));
  await vi.waitFor(() => expect(root.textContent).toContain("could not be displayed"));
  expect(root.textContent).toContain("Stored result"); expect(oldDispose).not.toHaveBeenCalled();
  expect(failedDispose).toHaveBeenCalledOnce();
  await app.onteardown!(); await app.onteardown!();
  expect(oldDispose).toHaveBeenCalledOnce(); expect(failedDispose).toHaveBeenCalledOnce();
});

it("continues server-timed expiry and progress observation after controls fail", async () => {
  let reads = 0;
  const app = host(async () => result(++reads === 1 ? state("account") : reads === 2
    ? state("account", { state: "running", revision: 1, inputRemainingMs: 0 })
    : state("account", { state: "closed", reason: "completed", revision: 2, data: {}, inputRemainingMs: 0 })));
  const controls = vi.fn(() => { throw new Error("fixture controls failure"); });
  startCard("account", { ...renderer, controls }); app.ontoolresult!(result(state("account"), true));
  await vi.waitFor(() => expect(root.textContent).toContain("could not be displayed"));
  expect(reads).toBe(1); expect(controls).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads).toBe(2); expect(root.textContent).toContain("Reading the requested data");
  await vi.advanceTimersByTimeAsync(5000);
  expect(reads).toBe(3); expect(root.textContent).toContain("Stored result");
  await vi.advanceTimersByTimeAsync(60_000); expect(reads).toBe(3);
  expect(controls).toHaveBeenCalledOnce();
});

it("stops after a lost-submit recovery read fails and retries only an explicit same-card read", async () => {
  let reads = 0;
  const app = host(async (request) => {
    if (request.name === CARD_TOOLS.submit) throw new Error("Lost submit reply");
    if (++reads === 2) throw new Error("State read unavailable");
    return result(reads === 1 ? state("account") : state("account", {
      state: "closed", reason: "completed", revision: 2, data: {}, inputRemainingMs: 0
    }));
  });
  startCard("account", renderer); app.ontoolresult!(result(state("account"), true));
  await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false)); submitButton()!.click();
  await vi.waitFor(() => expect(root.textContent).toContain("State read unavailable"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(app.callServerTool.mock.calls.map(([call]) => call.name)).toEqual([CARD_TOOLS.read, CARD_TOOLS.submit, CARD_TOOLS.read]);
  expect(submitButton()?.disabled).toBe(true);
  root.querySelectorAll("button").find((button) => button.textContent === "Read saved state")!.click();
  await vi.waitFor(() => expect(root.textContent).toContain("Stored result"));
  expect(app.callServerTool.mock.calls.map(([call]) => call.name)).toEqual([CARD_TOOLS.read, CARD_TOOLS.submit, CARD_TOOLS.read, CARD_TOOLS.read]);
});

it("consumes real MCP/SQLite chart preparation failures and valid choices in the actual Chart view", async () => {
  let unavailable = true, poolCalls = 0, candleCalls = 0;
  const metadata = { baseUrl: "https://example.invalid", endpoint: "get_pools" as const,
    url: "https://example.invalid/get_pools", fetchedAt: "2026-09-22T00:00:00.000Z", sourceStatement: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT } as const;
  const chart = createDeepbookUsdcChartService({ source: {
    fetchPools: async () => {
      poolCalls++;
      if (unavailable) throw new Error("fixture Indexer outage");
      return { source: metadata, pools: [{ pool_name: "SUI_USDC", pool_id: `0x${"1".repeat(64)}`,
        base_asset_id: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI", base_asset_symbol: "SUI", base_asset_decimals: 9,
        quote_asset_id: DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE, quote_asset_symbol: "USDC", quote_asset_decimals: 6 }] };
    },
    fetchCandles: async () => { candleCalls++; return { candles: [], source: { ...metadata, endpoint: "ohclv" as const } }; }
  } });
  const database = new SqliteActivityStore({ databasePath: ":memory:", validateAdapterLifecycle: validateSupportedAdapterLifecycle });
  const records = database.createCardRecordStore();
  const cards = createReadCardStore({ records, ownerId: "fixture-owner", chart,
    readService: { summarizeAccountInventory: async () => { throw new Error("Unexpected account call"); } },
    publicChainReceiptReader: async () => { throw new Error("Unexpected receipt call"); }
  });
  const server = new McpServer({ name: "chart-fixture", version: "1" });
  registerReadCards(server, { activityStore: database, cards: { store: cards } });
  const client = new Client({ name: "chart-test", version: "1" }, { capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  const dispatch = async (request: { name: string; arguments: Record<string, unknown> }) => CallToolResultSchema.parse(await client.callTool(request));
  try {
    const failed = await dispatch({ name: CARD_TOOLS.chart, arguments: {} });
    const failure = (failed.structuredContent as { data: CardSnapshot }).data;
    expect(failure).toMatchObject({ state: "closed", reason: "failed", revision: 0 });
    expect(records.get(failure.cardId)?.acceptedInput).toBeUndefined();
    const failedControls = vi.fn(chartRenderer.controls);
    for (let frame = 0; frame < 2; frame++) {
      const app = host(dispatch); startCard("chart", { ...chartRenderer, controls: failedControls }); app.ontoolresult!(failed);
      await vi.waitFor(() => expect(app.callServerTool).toHaveBeenCalledOnce());
      expect(root.textContent).toContain("pool list could not be read");
      expect(root.textContent).toContain("Request a new chart card");
      await app.onteardown!();
    }
    expect(failedControls).not.toHaveBeenCalled(); expect(poolCalls).toBe(1); expect(candleCalls).toBe(0);
    unavailable = false;
    const ready = await dispatch({ name: CARD_TOOLS.chart, arguments: {} });
    const app = host(dispatch); startCard("chart", chartRenderer); app.ontoolresult!(ready);
    await vi.waitFor(() => expect(root.querySelector("form")).toBeDefined());
    expect(root.textContent).toContain("SUI / USDC");
    root.querySelectorAll("select")[0]!.value = "SUI_USDC";
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(root.textContent).toContain("No candles returned for this range"));
    expect(root.textContent).toContain("Saved result");
    expect(poolCalls).toBe(2); expect(candleCalls).toBe(1);
    expect(app.callServerTool.mock.calls.map(([call]) => call.name)).toEqual([CARD_TOOLS.read, CARD_TOOLS.submit]);
    await app.onteardown!();
  } finally { await client.close(); await server.close(); cards.stop(); database.close(); }
});

it.each(["success", "failure"] as const)("the actual Connect view observes a delayed disconnect %s across frame recreation", async (outcome) => {
  const f = await walletWorkflowFixture(), { connection } = await f.approve();
  const pending = deferred<void>(); vi.mocked(f.transport.disconnect).mockImplementationOnce(() => pending.promise);
  const server = new McpServer({ name: "connect-view-fixture", version: "1" });
  const deps = { cards: { store: f.cards }, activityStore: f.activity, sessions: f.sessions, workflow: f.workflow, logger: f.logger } as unknown as McpServerDeps;
  registerReadCards(server, deps); registerWalletConnectionTools(server, deps);
  const client = new Client({ name: "view-fixture", version: "1" }, { capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  const call = (request: { name: string; arguments: Record<string, unknown> }) => f.run(async () => CallToolResultSchema.parse(await client.callTool(request)));
  const created = await call({ name: TOOL_NAMES.sessionCreateWalletConnection, arguments: {} });
  try {
    const first = host(call); startCard("connect", connectRenderer); first.ontoolresult!(created);
    await vi.waitFor(() => expect(root.querySelectorAll("button").find((button) => button.dataset.cardAction === "disconnect")?.disabled).toBe(false));
    root.querySelectorAll("button").find((button) => button.dataset.cardAction === "disconnect")!.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Wallet disconnection is in progress."));
    expect(f.transport.disconnect).toHaveBeenCalledOnce();
    await first.onteardown!();
    root = new Element("main"); const second = host(call); startCard("connect", connectRenderer); second.ontoolresult!(created);
    await vi.waitFor(() => expect(root.textContent).toContain("Wallet disconnection is in progress."));
    f.notify({ topic: "fixture-topic", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet",
      expiresAt: new Date(Date.parse(connection.expiresAt) + 1000).toISOString() });
    await vi.advanceTimersByTimeAsync(5000);
    expect(root.textContent).toContain("Wallet disconnection is in progress.");
    if (outcome === "success") pending.resolve(); else pending.reject(new Error("Fixture disconnect failure"));
    await vi.waitFor(() => expect(f.run(() => f.records.connection(connection.connectionId)?.sdkPending)).toBe(false));
    await vi.advanceTimersByTimeAsync(5000);
    expect(root.textContent).not.toContain("Wallet disconnection is in progress.");
    expect(root.textContent).toContain(outcome === "success" ? "disconnected" : "The wallet disconnection could not be confirmed.");
    const reads = second.callServerTool.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(second.callServerTool).toHaveBeenCalledTimes(reads); expect(f.transport.disconnect).toHaveBeenCalledOnce();
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await second.onteardown!();
  } finally { await client.close(); await server.close(); f.close(); }
});

it("renders verified review conditions before decisions and preserves the exact approval selection", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
    const snapshot = structuredClone(card.snapshot), data = workflowViewSchema.parse(snapshot.data);
    // Graph drawing is covered by the built HTML; omit that optional artifact
    // here to exercise the real financial rows/actions with DOM primitives.
    data.review!.state!.ptbVisualization = undefined;
    snapshot.data = data;
    const act = vi.fn(), rendered = reviewRenderer.result(snapshot, undefined, act);
    const node = rendered.node as unknown as Element;
    const primary = node.children[0]!;
    const text = primary.textContent;
    // Fixture source: 123456789 raw USDC (6 decimals); 50 bps policy floors
    // 123456789 * 9950 / 10000 to 122839505. These are not renderer outputs.
    expect(text).toContain("You send, up to1 SUI");
    expect(text).toContain("Expected receive123.456789 USDC");
    expect(text).toContain("Minimum receive if execution succeeds122.839505 USDC");
    expect(text.indexOf("Reviewed account")).toBeLessThan(text.indexOf("You send, up to"));
    expect(text.indexOf("Minimum receive")).toBeLessThan(text.indexOf("StatusReady for wallet review"));
    expect(text).toContain("ask for a new review in chat");
    expect(text).not.toContain("Review revision");
    const form = primary.querySelectorAll("form").find((item) => item.querySelectorAll("button").some((button) => button.dataset.cardAction === "request_signature"))!;
    form.querySelector("select")!.value = connection.connectionId;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(act).toHaveBeenCalledExactlyOnceWith({ action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: 1 });
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    rendered.dispose();
    data.review!.preparing = true; data.allowedActions = [];
    const preparing = reviewRenderer.result({ ...snapshot, data }, undefined, act);
    expect(preparing.node.textContent).toContain("Updating review…");
    expect((preparing.node as unknown as Element).querySelectorAll("button")).toEqual([]);
    preparing.dispose();
    data.review!.preparing = false; data.review!.status = "refresh_required";
    data.review!.error = "Previous review update: Fixture computation unavailable";
    data.allowedActions = ["prepare_review", "cancel"];
    const refresh = reviewRenderer.result({ ...snapshot, data }, undefined, act);
    expect(refresh.node.textContent).toContain("Refresh required");
    expect(refresh.node.textContent).toContain(data.review!.error);
    expect((refresh.node as unknown as Element).querySelectorAll("button").map((button) => button.dataset.cardAction)).toEqual(["prepare_review", "cancel"]);
    refresh.dispose();
  } finally { f.close(); }
});

it.each([
  ["awaiting_signature", "Waiting for wallet approval"], ["submitting", "Submitting transaction"],
  ["awaiting_chain_result", "Waiting for a chain result"], ["outcome_unknown", "Chain result not confirmed"],
  ["stopped", "Local waiting stopped"], ["request_failed", "Wallet request ended"]
] as const)("renders %s without presenting an unobserved chain outcome", (requestStatus, label) => {
  const account = `0x${"a".repeat(64)}`, at = "2030-01-01T00:00:00.000Z";
  const data: WorkflowView = {
    kind: "review", mode: "review_manage", allowedActions: ["read_result"], actionRemainingMs: 0, observe: false,
    progress: { status: "idle" }, walletAvailability: { status: "available" }, connections: [], boundary: REVIEW_BOUNDARY,
    review: { reviewSessionId: "review", reviewRevision: 1, status: "ready_for_wallet_review", account, preparing: false,
      plan: { id: "plan", actionKind: "swap", adapterId: "deepbook-swap", adapterData: {}, protocol: "DeepBookV3", title: "Review swap", summary: "Stored proposal", createdAt: at,
        assetFlowPreview: { outgoing: [{ symbol: "SUI", amount: "1", amountKind: "display_intent" }], expectedIncoming: [] } } },
    request: { attemptId: "attempt", reviewSessionId: "review", planId: "plan", reviewRevision: 1, account,
      transactionDigest: "DhZ8kuDhDm32iJ8Rqd5eY4EwrFn8ga9ob4nAMM7bBJLq", requestStatus, revision: 0, createdAt: at, updatedAt: at,
      reason: "Stored interruption reason" }
  };
  const act = vi.fn(), rendered = reviewRenderer.result(state("review", { data }), undefined, act);
  const node = rendered.node as unknown as Element, primary = node.children[0]!;
  expect(primary.textContent).toContain(`Status${label}`);
  expect(primary.textContent).toContain("Stored interruption reason");
  expect(primary.textContent).toContain("No chain execution result has been confirmed");
  expect(primary.textContent).toContain("Proposed send (display input)1 SUI");
  expect(node.textContent).not.toContain("Transaction succeeded on Sui");
  expect(node.textContent).not.toContain("Transaction failed on Sui");
  expect(primary.querySelectorAll("button").map((button) => button.dataset.cardAction)).toEqual(["read_result"]);
  primary.querySelector("button")!.click();
  expect(act).toHaveBeenCalledExactlyOnceWith({ action: "read_result" });
  rendered.dispose();
});

it.each(["success", "failure"] as const)("puts independently verified %s before review and request records", async (outcome) => {
  const f = await walletWorkflowFixture({ receiptDetails: true });
  try {
    const { connection } = await f.approve(), { card, session } = await f.prepare(connection.connectionId);
    f.setChainOutcome(outcome);
    await f.act(card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: 1 });
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(session.id)?.requestStatus)).toBe("completed"));
    const snapshot = structuredClone((await f.read(card)).snapshot), data = workflowViewSchema.parse(snapshot.data);
    data.review!.state!.ptbVisualization = undefined; snapshot.data = data;
    const rendered = reviewRenderer.result(snapshot, undefined, undefined), node = rendered.node as unknown as Element;
    expect(node.children[0]!.textContent).toContain(outcome === "success" ? "Transaction succeeded on Sui" : "Transaction failed on Sui");
    expect(node.children[0]!.textContent).not.toContain("Transaction request record");
    expect(node.textContent).toContain(data.request!.transactionDigest);
    expect(node.textContent).toContain("Review revision1");
    expect(node.querySelectorAll("button").some((button) => button.dataset.cardAction === "request_signature")).toBe(false);
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce();
    rendered.dispose();
  } finally { f.close(); }
});

it("refuses a mismatched creating identity before the first state read", async () => {
  const app = host(async () => { throw new Error("Must not read a mismatched card"); });
  const creating = result(state("receipt"), true);
  creating._meta = { [CARD_METADATA_KEY]: { cardId: "another-card", permission: "fixture-permission" } };
  startCard("receipt", renderer); app.ontoolresult!(creating);
  await vi.waitFor(() => expect(root.textContent).toContain("Card identity changed"));
  expect(app.callServerTool).not.toHaveBeenCalled(); expect(submitButton()).toBeUndefined();
});

it("preserves a known fixed result and its display controls when current-state confirmation fails", async () => {
  const completed = state("receipt", { state: "closed", reason: "completed", revision: 2, data: {}, inputRemainingMs: 0 });
  const app = host(async () => { throw new Error("State read unavailable"); });
  startCard("receipt", renderer); app.ontoolresult!(result(completed, true));
  await vi.waitFor(() => expect(root.textContent).toContain("State read unavailable"));
  expect(root.textContent).toContain("Stored result");
  const details = root.querySelectorAll("button").find((button) => button.textContent === "Show details")!;
  expect(details.disabled).toBe(false); details.click();
  expect(root.textContent).toContain("Stored result details");
  await vi.advanceTimersByTimeAsync(60_000); expect(app.callServerTool).toHaveBeenCalledOnce();
});

it("keeps stored content and offers explicit reading without polling when wallet progress is unavailable", async () => {
  const pending = state("review", { state: "running", data: { allowedActions: [], actionRemainingMs: 0,
    observe: false, walletAvailability: { status: "unavailable", reason: "restoration_failed", message: "Restart the local backend." },
    progress: { status: "unavailable", reason: "wallet_unavailable", message: "Restart the local backend." } } });
  const app = host(async () => result(pending));
  startCard("review", renderer); app.ontoolresult!(result(pending, true));
  await vi.waitFor(() => expect(root.textContent).toContain("Stored result"));
  expect(root.textContent).toContain("progress unavailable");
  expect(root.querySelectorAll("button").some((button) => button.textContent === "Read saved state")).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000); expect(app.callServerTool).toHaveBeenCalledTimes(1);
  root.querySelectorAll("button").find((button) => button.textContent === "Read saved state")!.click();
  await vi.waitFor(() => expect(app.callServerTool).toHaveBeenCalledTimes(2));
  expect(app.callServerTool.mock.calls.every(([request]) => request.name === CARD_TOOLS.read)).toBe(true);
  await app.onteardown!(); expect(vi.getTimerCount()).toBe(0);
});
