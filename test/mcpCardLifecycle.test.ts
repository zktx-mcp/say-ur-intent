import { LIVE_REVIEW_SESSION_WRITE_CONTRACT_VERSION } from "../src/core/session/liveReviewSessionContract.js";
import Database from "better-sqlite3";
import { DeepbookOfficialIndexerSourceError } from "../src/core/read/deepbookOfficialIndexerSource.js";
import { projectReadCardResult } from "../src/core/read/readCardResult.js";
import { receiptForCard } from "../src/mcp-ui/view/receiptData.js";
import { accountRenderer } from "../src/mcp-ui/view/account.js";
import { receiptRenderer } from "../src/mcp-ui/view/receipt.js";
import { chainReceiptDetails } from "../review-app/src/ui/chainReceiptView.js";
import { readPublicChainReceipt } from "../src/core/action/suiChainReceiptReader.js";
import { cardReceiptTransaction } from "./fixtures/cardReceiptTransaction.js";
import { chainReceiptDigest } from "./fixtures/chainReceipt.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { errorToolResult } from "../src/mcp/result.js";
import { cardToolResult, createWorkflowCard, registerReadCards } from "../src/mcp-ui/tools.js";
import { createReadCardStore } from "../src/mcp-ui/readCards.js";
import { SqliteActivityStore } from "../src/core/activity/sqliteActivityStore.js";
import { validateSupportedAdapterLifecycle } from "../src/adapters/adapterLifecycleValidators.js";
import { createDeepbookUsdcChartService } from "../src/core/read/deepbookUsdcChartService.js";
import { DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE, DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT } from "../src/core/read/deepbookOfficialIndexerSource.js";
import { chartRenderer } from "../src/mcp-ui/view/chart.js";
import { reviewRenderer } from "../src/mcp-ui/view/review.js";
import { externalProposalSchema } from "../src/core/proposal/schemas.js";
import { externalProposalToActionPlan } from "../src/core/proposal/externalProposalReview.js";
import { computeReviewState } from "../src/core/review/reviewComputation.js";
import { workflowViewSchema, REVIEW_BOUNDARY, type WorkflowView } from "../src/core/session/workflowView.js";
import { connectRenderer } from "../src/mcp-ui/view/connect.js";
import { registerWalletConnectionTools } from "../src/mcp/tools/session/walletConnectionTools.js";
import type { McpServerDeps } from "../src/mcp/server.js";
import { walletWorkflowFixture, deferred } from "./fixtures/walletWorkflow.js";
import { TOOL_NAMES } from "../src/mcp/toolNames.js";
import { CARD_METADATA_KEY, CARD_RESOURCE_PREFIX, CARD_TOOLS, cardReferenceSchema, cardSubmissionSchema, type CardKind, type CardSnapshot } from "../src/mcp-ui/contracts.js";
import { startCard, type CardContent, type CardRenderer } from "../src/mcp-ui/view/lifecycle.js";
import QRCode from "qrcode";

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
vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg></svg>" })) } }));
// Canvas drawing is external to the DOM fixture. Tests below inject its failure
// while retaining the real Connect renderer, lifecycle, MCP envelope and store.
vi.mock("qrcode", () => ({ default: { toCanvas: vi.fn(async () => undefined) } }));
vi.mock("@modelcontextprotocol/ext-apps", () => ({ App: class {
  constructor() { const app = transport.pending.shift(); if (!app) throw new Error("Missing prepared Host transport."); return app; }
} }));

// DOM primitives only; initialization, state handling, retries and timer cleanup
// all execute the real lifecycle module. Layout remains an actual Host check.
class Element extends EventTarget {
  children: Element[] = [];
  parent: Element | undefined;
  ownText = "";
  className = "";
  classList = {
    add: (...names: string[]) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
    remove: (...names: string[]) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); }
  };
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  clientHeight = 0;
  offsetHeight = 0;
  disabled = false;
  dataset: Record<string, string> = {};
  value = "";
  readOnly = false;
  open = false;
  hidden = false;
  isConnected = true;
  readonly tagName: string;
  constructor(tagName: string) { super(); this.tagName = tagName.toUpperCase(); }
  set textContent(text: string) { this.ownText = text; for (const child of this.children) child.parent = undefined; this.children = []; }
  get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  append(...items: Array<Element | string>): void { for (const value of items) {
    const item = typeof value === "string" ? new Element("#text") : value;
    if (typeof value === "string") item.textContent = value;
    item.remove(); item.parent = this; this.children.push(item);
  } }
  prepend(...items: Element[]): void { for (const item of items) { item.remove(); item.parent = this; } this.children.unshift(...items); }
  insertBefore(item: Element, before: Element): void { item.remove(); item.parent = this; this.children.splice(this.children.indexOf(before), 0, item); }
  replaceChildren(...items: Element[]): void { this.textContent = ""; this.append(...items); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = undefined; }
  querySelectorAll(selector: string): Element[] {
    const tags = selector.split(",").map((value) => value.trim());
    return this.children.flatMap((child) => [...(tags.includes(child.tagName.toLowerCase()) || tags.some((tag) => tag.startsWith(".") && child.className.split(/\s+/).includes(tag.slice(1))) ||
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
  vi.mocked(QRCode.toCanvas).mockReset().mockResolvedValue(undefined);
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  root = new Element("main");
  vi.stubGlobal("document", { getElementById: () => root, createElement: (tag: string) => new Element(tag),
    createTextNode: (text: string) => { const node = new Element("#text"); node.textContent = text; return node; }, documentElement: new Element("html") });
  vi.stubGlobal("Option", class extends Element {
    constructor(text: string, value: string) { super("option"); this.textContent = text; this.value = value; }
  });
  vi.stubGlobal("__SUI_MCP_VERSION__", "fixture");
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#222222" }));
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
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
    expect(root.textContent).toContain("The time to make a selection has ended."); expect(submitButton()).toBeUndefined(); expect(reads).toBe(2);
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
    root.querySelectorAll("button").find((button) => button.textContent === "Check status")!.click();
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
    missing.readServerResource.mockResolvedValue(savedResource(ready));
    startCard("account", renderer); missing.ontoolresult!(result(ready));
    await vi.waitFor(() => expect(root.textContent).toContain("View only"));
    expect(missing.readServerResource).toHaveBeenCalledOnce();
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
  expect(root.textContent).not.toContain("Saved result");
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
  root.querySelectorAll("button").find((button) => button.textContent === "Check status")!.click();
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
  registerReadCards(server, { activityStore: database, cards: { store: cards }, logger: { error: vi.fn() } });
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
      expect(root.textContent).toContain("available trading pairs could not be loaded");
      expect(root.textContent).toContain("Ask in chat for a new chart");
      await app.onteardown!();
    }
    expect(failedControls).not.toHaveBeenCalled(); expect(poolCalls).toBe(1); expect(candleCalls).toBe(0);
    unavailable = false;
    const ready = await dispatch({ name: CARD_TOOLS.chart, arguments: {} });
    const app = host(dispatch); startCard("chart", chartRenderer); app.ontoolresult!(ready);
    await vi.waitFor(() => expect(root.querySelector("form")).toBeDefined());
    expect(root.textContent).toContain("SUI / USDC");
    expect(root.textContent).toContain("Set the time range and interval before choosing a pair, if needed.");
    expect(root.querySelector("summary")!.textContent).toBe("Time range & interval");
    root.querySelectorAll("select")[0]!.value = "SUI_USDC";
    const [start, end] = root.querySelectorAll("input");
    start!.value = "2026-06-27T01:00"; end!.value = "2026-06-27T00:00";
    root.querySelectorAll("select")[0]!.dispatchEvent(new Event("change"));
    expect(root.textContent).toContain("Start must precede end");
    expect(candleCalls).toBe(0);
    start!.value = "2026-06-26T00:00";
    start!.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(root.textContent).toContain("No candles returned for this range"));
    expect(root.textContent).not.toContain("Saved result");
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
    expect(root.querySelectorAll("h1, h2").filter((heading) => heading.textContent === "Wallet connection")).toHaveLength(1);
    expect(root.querySelectorAll("section").filter((section) => section.className === "ui-card")).toHaveLength(0);
    expect(factValues(root, "Network")).toEqual(["Sui mainnet"]);
    expect(factValues(root, "Status")).toEqual(["Wallet connected"]);
    expect(root.querySelectorAll("button").map((control) => control.textContent)).toEqual(["Disconnect"]);
    const walletRow = root.querySelectorAll("div").find((item) => item.className === "ui-row" && item.children[0]?.textContent === "Approved address")!;
    expect((walletRow.children[1]!.children[0] as unknown as HTMLElement).title).toBe(f.account);
    root.querySelectorAll("button").find((button) => button.textContent === "Disconnect")!.click();
    expect(root.textContent.match(/Sui mainnet/g)).toHaveLength(1);
    expect(f.transport.disconnect).not.toHaveBeenCalled();
    const staleConfirm = root.querySelectorAll("button").find((button) => button.textContent === "Confirm disconnect")!;
    f.notify({ ...f.transport.session("fixture-topic")!, expiresAt: new Date(Date.parse(connection.expiresAt) + 1000).toISOString() });
    staleConfirm.click();
    await vi.waitFor(() => expect(root.textContent).toContain("This request does not match the card's current state."));
    expect(f.transport.disconnect).not.toHaveBeenCalled();
    staleConfirm.click(); // Detached confirmation cannot acquire a newer revision.
    expect(f.transport.disconnect).not.toHaveBeenCalled();
    root.querySelectorAll("button").find((button) => button.textContent === "Disconnect")!.click();
    root.querySelectorAll("button").find((button) => button.textContent === "Back")!.click();
    expect(f.transport.disconnect).not.toHaveBeenCalled();
    expect(root.querySelectorAll("section").filter((section) => section.className === "ui-card")).toHaveLength(0);
    expect(root.querySelectorAll("button").map((control) => control.textContent)).toEqual(["Disconnect"]);
    root.querySelectorAll("button").find((button) => button.textContent === "Disconnect")!.click();
    root.querySelectorAll("button").find((button) => button.textContent === "Confirm disconnect")!.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Disconnecting wallet…"));
    expect(f.transport.disconnect).toHaveBeenCalledOnce();
    await first.onteardown!();
    root = new Element("main"); const second = host(call); startCard("connect", connectRenderer); second.ontoolresult!(created);
    await vi.waitFor(() => expect(root.textContent).toContain("Disconnecting wallet…"));
    f.notify({ topic: "fixture-topic", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet",
      expiresAt: new Date(Date.parse(connection.expiresAt) + 1000).toISOString() });
    await vi.advanceTimersByTimeAsync(5000);
    expect(root.textContent).toContain("Disconnecting wallet…");
    if (outcome === "success") pending.resolve(); else pending.reject(new Error("Fixture disconnect failure"));
    await vi.waitFor(() => expect(f.run(() => f.records.connection(connection.connectionId)?.sdkPending)).toBe(false));
    await vi.advanceTimersByTimeAsync(5000);
    expect(root.textContent).not.toContain("Disconnecting wallet…");
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
    const primary = node.children.find((item) => item.className === "ui-section")!;
    const text = primary.textContent;
    // Fixture source: 123456789 raw USDC (6 decimals); 50 bps policy floors
    // 123456789 * 9950 / 10000 to 122839505. These are not renderer outputs.
    expect(text).toContain("You send, up to1 SUI");
    expect(text).toContain("Expected to receive123.456789 USDC");
    expect(text).toContain("Minimum received on success122.839505 USDC");
    expect(text).toContain("Estimated trading fee0.025 DEEP");
    expect(text).toContain("Estimated network fee0.00000013 SUI · Network fee limit (gas budget): 0.000001 SUI");
    expect(text.indexOf("Send and receive account")).toBeLessThan(text.indexOf("You send, up to"));
    expect(text.indexOf("Minimum receive")).toBeLessThan(text.indexOf("StatusReady for your review"));
    expect(text).not.toContain("ask for a new review in chat");
    expect(text).not.toContain("Wallet approval required");
    expect(text).not.toContain("Review revision");
    expect(text).not.toContain("has not simulated");
    const disclosure = node.querySelectorAll("details").find((item) => item.querySelector("summary")?.textContent === "Details")!;
    disclosure.open = true; disclosure.dispatchEvent(new Event("toggle"));
    const stageNotes = disclosure.querySelectorAll("section").find((item) => item.textContent.startsWith("Notes from the initial review checks"))!;
    expect(disclosure.querySelectorAll("details")).toHaveLength(0);
    expect(stageNotes.textContent).toContain("before the final checks");
    expect(stageNotes.textContent).toContain("Wallet approval required");
    expect(disclosure.textContent).toContain("ask for a new review in chat");
    expect(disclosure.textContent).not.toContain("Cancel");
    expect(primary.querySelectorAll("button").find((item) => item.dataset.cardAction === "cancel")?.getAttribute("aria-label")).toBe("Cancel review");
    expect(stageNotes.textContent).toContain("Execution not confirmed");
    expect(primary.textContent).not.toContain("Execution not confirmed");

    expect(primary.querySelectorAll("select")).toEqual([]);
    expect(act).not.toHaveBeenCalled();
    const approve = primary.querySelectorAll("button").find((item) => item.dataset.cardAction === "request_signature")!;
    approve.click();
    expect(act).toHaveBeenCalledExactlyOnceWith({ action: "request_signature", walletRunId: f.runtime.runId, connectionId: connection.connectionId, account: f.account, reviewRevision: 1 });
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    rendered.dispose(); approve.click(); expect(act).toHaveBeenCalledOnce();
    data.review!.preparing = true; data.allowedActions = [];
    const preparing = reviewRenderer.result({ ...snapshot, data }, undefined, act);
    expect(preparing.node.textContent).toContain("Updating review…");
    const disabledRequest = (preparing.node as unknown as Element).querySelector(".review-primary-action")!;
    expect(disabledRequest.disabled).toBe(true);
    expect(disabledRequest.dataset.cardAction).toBeUndefined();
    disabledRequest.click(); expect(act).toHaveBeenCalledOnce();
    preparing.dispose();
    data.review!.preparing = false; data.review!.status = "refresh_required";
    data.review!.error = "Earlier review message: Fixture computation unavailable";
    data.allowedActions = ["prepare_review", "cancel"];
    const refresh = reviewRenderer.result({ ...snapshot, data }, undefined, act);
    expect(refresh.node.textContent).toContain("Review needs updating");
    expect(refresh.node.textContent).toContain(data.review!.error);
    expect((refresh.node as unknown as Element).querySelectorAll("[data-card-action]").map((button) => button.dataset.cardAction)).toEqual(["prepare_review", "cancel"]);
    expect((refresh.node as unknown as Element).querySelector(".review-primary-action")!.disabled).toBe(false);
    expect((refresh.node as unknown as Element).querySelector(".review-primary-action")!.textContent).toBe("Retry review");
    refresh.dispose();
  } finally { f.close(); }
});

it.each([
  ["awaiting_signature", "Waiting for approval in your wallet"], ["submitting", "Submitting transaction"],
  ["awaiting_chain_result", "Waiting for transaction result"], ["outcome_unknown", "Transaction result not confirmed"],
  ["stopped", "Approval request stopped"], ["request_failed", "Approval request ended"]
] as const)("renders %s without presenting an unobserved chain outcome", (requestStatus, label) => {
  const account = `0x${"a".repeat(64)}`, at = "2030-01-01T00:00:00.000Z";
  const data: WorkflowView = {
    kind: "review", mode: "review_manage", allowedActions: ["read_result"], actionRemainingMs: 0, observe: false,
    progress: { status: "idle" }, walletAvailability: { status: "available", walletRunId: "00000000-0000-4000-8000-000000000001" }, connections: [], boundary: REVIEW_BOUNDARY,
    review: { reviewSessionId: "review", reviewRevision: 1, status: "ready_for_wallet_review", account, preparing: false,
      plan: { id: "plan", actionKind: "swap", adapterId: "deepbook-swap", adapterData: {}, protocol: "DeepBookV3", title: "Review swap", summary: "Stored proposal", createdAt: at,
        assetFlowPreview: { outgoing: [{ symbol: "SUI", amount: "1", amountKind: "display_intent" }], expectedIncoming: [] } } },
    request: { attemptId: "attempt", reviewSessionId: "review", planId: "plan", reviewRevision: 1, account,
      transactionDigest: "DhZ8kuDhDm32iJ8Rqd5eY4EwrFn8ga9ob4nAMM7bBJLq", requestStatus, revision: 0, createdAt: at, updatedAt: at,
      reason: "Stored interruption reason" }
  };
  const act = vi.fn(), rendered = reviewRenderer.result(state("review", { data }), undefined, act);
  const node = rendered.node as unknown as Element, primary = node.children.find((item) => item.className === "ui-section")!;
  expect(primary.textContent).toContain(`Status${label}`);
  expect(primary.textContent).toContain("Stored interruption reason");
  if (["stopped", "request_failed"].includes(requestStatus)) expect(primary.textContent).toContain("No chain execution result has been confirmed");
  expect(primary.textContent).toContain("Requested send1 SUI");
  expect(node.textContent.split(label)).toHaveLength(2);
  const conditions = node.querySelectorAll("details").find((item) => item.querySelector("summary")?.textContent === "Details")!;
  conditions.open = true; conditions.dispatchEvent(new Event("toggle"));
  expect(conditions.textContent).not.toContain("Requested send1 SUI");
  expect(conditions.querySelectorAll("details")).toHaveLength(0);
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
    expect(node.children.find((item) => item.className === "ui-section")!.textContent).toContain(outcome === "success" ? "Transaction succeeded on Sui" : "Transaction failed on Sui");
    expect(node.children[0]!.textContent).not.toContain("Transaction request record");
    expect(node.children[0]!.textContent).toContain("transaction graph");
    expect(node.textContent).not.toContain("Review revision");
    expect(node.textContent).not.toContain("Estimated network fee");
    const conditions = node.querySelectorAll("details").find((item) => item.querySelector("summary")?.textContent === "Details")!;
    conditions.open = true; conditions.dispatchEvent(new Event("toggle"));
    expect(conditions.textContent).toContain("Estimated network fee");
    expect(conditions.textContent).toContain(data.request!.transactionDigest);
    expect(conditions.querySelectorAll("details")).toHaveLength(0);
    const original = conditions.textContent;
    conditions.open = false; conditions.dispatchEvent(new Event("toggle"));
    conditions.open = true; conditions.dispatchEvent(new Event("toggle"));
    expect(conditions.textContent).toBe(original);
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
  await vi.waitFor(() => expect(root.textContent).toContain("The returned information does not match this card"));
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
  expect(root.textContent).toContain("progress is unavailable");
  expect(root.querySelectorAll("button").some((button) => button.textContent === "Check status")).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000); expect(app.callServerTool).toHaveBeenCalledTimes(1);
  root.querySelectorAll("button").find((button) => button.textContent === "Check status")!.click();
  await vi.waitFor(() => expect(app.callServerTool).toHaveBeenCalledTimes(2));
  expect(app.callServerTool.mock.calls.every(([request]) => request.name === CARD_TOOLS.read)).toBe(true);
  await app.onteardown!(); expect(vi.getTimerCount()).toBe(0);
});


it.each(["account", "receipt"] as const)("shows %s input requests without forms, state reads or polling", async (kind) => {
  const message = kind === "account" ? "Please provide a Sui address in chat." : "Please provide a transaction hash in chat.";
  const response = { content: [], structuredContent: { ok: true, data: {
    kind, status: "input_required", field: kind === "account" ? "account" : "digest", message
  } } };
  for (let frame = 0; frame < 2; frame++) {
    root = new Element("main");
    const app = host(async () => { throw new Error("Input requests must not read a card."); });
    startCard(kind, renderer); app.ontoolresult!(response);
    await vi.waitFor(() => expect(root.textContent).toContain(message));
    app.ontoolresult!(response); await vi.advanceTimersByTimeAsync(60_000);
    expect(root.querySelectorAll("input, button, select")).toHaveLength(0);
    expect(root.textContent).not.toContain("Card unavailable");
    expect(app.callServerTool).not.toHaveBeenCalled(); expect(app.readServerResource).not.toHaveBeenCalled();
    await app.onteardown!();
  }
});


it("shows account totals and coverage without storage-format or object-type details", () => {
  const account = `0x${"a".repeat(64)}`;
  const snapshot = state("account", { state: "closed", reason: "completed", data: { status: "ok", account, name: "Example",
    fetchedAt: "2026-09-27T00:00:00.000Z", balances: [{ balance: "3000000", coinBalance: "1000000", addressBalance: "2000000",
      coinType: "0xb::usdc::USDC", unit: { status: "available", decimals: 6, symbol: "USDC" } }], nfts: [],
    objectGroups: [{ type: "0xfixture::internal::DebugType", count: 2 }], objectsTruncated: true } });
  const view = accountRenderer.result(snapshot).node;
  expect(view.textContent).toContain("USDC3"); // 3,000,000 units / 10^6, not the 1+2 storage split.
  expect(view.textContent).toContain("2 other owned objects");
  expect(view.textContent).not.toContain("DebugType");
  expect(view.textContent).not.toContain("Object balance");
  expect(Array.from(view.querySelectorAll("span")).some((item) => item.title === account)).toBe(true);
  expect(accountRenderer.controls().querySelectorAll("input")).toHaveLength(0);
});

it("summarizes the real receipt without removing the full Review receipt display", async () => {
  const response = await readPublicChainReceipt({ network: "mainnet", expectedChainIdentifier: "mainnet-chain", client: { core: {
    getChainIdentifier: async () => ({ chainIdentifier: "mainnet-chain" }),
    getTransaction: async () => ({ $kind: "Transaction" as const, Transaction: cardReceiptTransaction })
  } } }, { digest: chainReceiptDigest, now: new Date("2026-09-27T00:00:00.000Z") });
  expect(response.status).toBe("found"); if (response.status !== "found") throw new Error("Receipt fixture failed");
  const projected = projectReadCardResult("receipt", { digest: chainReceiptDigest }, response);
  const snapshot = state("receipt", { state: "closed", reason: "completed", data: projected.data });
  const summary = receiptRenderer.result(snapshot, undefined).node;
  expect(summary.textContent).toContain("Transaction succeeded on Sui");
  expect(summary.textContent).toContain("0.00000013 SUI"); // (100 + 50 - 20) MIST, independently computed.
  expect(summary.textContent).not.toContain("Transaction graph"); expect(summary.textContent).not.toContain("Transaction records");
  expect(summary.textContent).not.toContain("Computation");
  const full = chainReceiptDetails(receiptForCard(snapshot));
  expect(full.textContent).toContain("Inputs"); expect(full.textContent).toContain("Computation");
  expect(full.textContent).toContain(response.receipt.balanceChanges[0]!.coinType);
  expect(receiptRenderer.controls().querySelectorAll("input")).toHaveLength(0);
});


it("shows last-recorded connection freshness when the wallet cannot be checked", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve();
    const card = await f.createConnection();
    vi.spyOn(f.transport, "inspectAll").mockImplementation(() => { throw new Error("PRIVATE SDK ERROR"); }); f.observe();
    const current = await f.read(card);
    const view = connectRenderer.controls(current.snapshot, vi.fn(), undefined, undefined);
    expect(view.node.textContent).toContain("Last recorded status");
    expect(view.node.textContent).toContain("Last updated");
    expect(view.node.textContent).toContain("2030-01-01 00:00:00 UTC");
    expect((view.node.querySelector("time") as HTMLTimeElement).dateTime).toBe(connection.updatedAt);
    expect(view.node.textContent).not.toContain("PRIVATE SDK ERROR");
    expect(view.node.querySelectorAll('[data-card-action]')).toHaveLength(0); // Saved connected-wallet facts remain visible without Close or wallet actions.
    expect(f.transport.disconnect).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled();
    view.dispose();
  } finally { f.close(); }
});


it("takes a single displayed wallet from preparation through actual SQLite admission without implicit actions", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve();
    const created = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    let card = await f.run(() => f.cards.create("review", { reviewSessionId: created.session.id }));
    let pending: Promise<unknown> | undefined;
    const act = vi.fn((input: Record<string, unknown>) => { pending = f.act(card, input); });
    let rendered = reviewRenderer.result(card.snapshot, undefined, act);
    let node = rendered.node as unknown as Element;
    expect(node.querySelectorAll("select")).toHaveLength(0);
    expect(f.quote).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled();
    expect(node.querySelectorAll("button").some((item) => item.textContent === "Review transaction")).toBe(false);
    const automatic = workflowViewSchema.parse(card.snapshot.data).automaticAction;
    expect(automatic).toEqual({ action: "prepare_review", walletRunId: f.runtime.runId, connectionId: connection.connectionId, account: f.account, reviewRevision: 0 });
    act(automatic!);
    await pending;
    await vi.waitFor(async () => {
      card = await f.read(card);
      expect(workflowViewSchema.parse(card.snapshot.data).review?.status).toBe("ready_for_wallet_review");
    });
    expect(act).toHaveBeenCalledExactlyOnceWith({ action: "prepare_review", walletRunId: f.runtime.runId, connectionId: connection.connectionId, account: f.account, reviewRevision: 0 });
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    rendered.dispose();
    rendered = reviewRenderer.result(card.snapshot, undefined, act); node = rendered.node as unknown as Element;
    expect(node.querySelectorAll("select")).toHaveLength(0);
    const approve = node.querySelectorAll("button").find((item) => item.dataset.cardAction === "request_signature")!;
    expect(f.sign).not.toHaveBeenCalled(); approve.click(); await pending;
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(created.session.id)?.requestStatus)).toBe("completed"));
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce();
    expect(act).toHaveBeenLastCalledWith({ action: "request_signature", walletRunId: f.runtime.runId, connectionId: connection.connectionId, account: f.account, reviewRevision: 1 });
    rendered.dispose(); approve.click(); expect(act).toHaveBeenCalledTimes(2);
  } finally { f.close(); }
});

it("offers no wallet selector or signature for multiple, zero or unavailable connections", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
    const snapshot = structuredClone(card.snapshot), data = workflowViewSchema.parse(snapshot.data);
    data.connections.push({ ...data.connections[0]!, connectionId: "second-connection", walletName: "Second wallet" });
    data.connectionConflict = { reason: "multiple_connections", connectionIds: [connection.connectionId, "second-connection"] };
    delete data.usableConnectionId; data.assetReadAccount = { status: "address_required" };
    snapshot.data = data;
    const act = vi.fn(), rendered = reviewRenderer.result(snapshot, undefined, act);
    const node = rendered.node as unknown as Element;
    expect(node.querySelectorAll("select")).toHaveLength(0);
    expect(node.querySelectorAll("button").some((b) => b.dataset.cardAction === "request_signature")).toBe(false);
    expect(act).not.toHaveBeenCalled();
    rendered.dispose();
    for (const unavailable of [false, true]) {
      data.connections = unavailable ? [connection] : [];
      delete data.connectionConflict;
      if (unavailable) data.walletAvailability = { status: "unavailable", reason: "restoration_failed", message: "Wallet state cannot be checked." };
      const blocked = reviewRenderer.result({ ...snapshot, data }, undefined, act);
      expect((blocked.node as unknown as Element).querySelectorAll("button").some((b) => b.dataset.cardAction === "request_signature")).toBe(false);
      blocked.dispose();
    }
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  } finally { f.close(); }
});

function factValues(node: Element, label: string): string[] {
  return node.querySelectorAll("div").filter((item) => item.className === "ui-row" && item.children[0]?.textContent === label)
    .map((item) => item.children[1]!.textContent);
}

function expectReviewAccount(account: string | undefined): void {
  const facts = root.querySelector(".review-material-facts")!;
  const rows = facts.querySelectorAll("div").filter((item) => item.className === "ui-row" &&
    ["Account to review", "Reviewed account", "Send and receive account"].includes(item.children[0]?.textContent ?? ""));
  expect(rows).toHaveLength(1);
  const value = rows[0]!.children[1]!;
  expect(value.textContent).toBe(account ? `${account.slice(0, 8)}…${account.slice(-6)}` : "Not selected");
  expect(value.querySelector(".ui-mono")?.getAttribute("aria-label")).toBe(account);
}

const proposalEvaluationTime = new Date("2030-01-01T00:00:00.000Z");
const proposalRecipient = `0x${"c".repeat(64)}`;
const proposalBase = {
  id: "private-proposal-record", source: { kind: "ai_client", name: "Invoice assistant", reference: "https://example.com/invoice/42" },
  network: "sui:mainnet", createdAt: "2029-12-31T23:00:00.000Z", expiresAt: "2030-01-01T01:23:45.000Z",
  purpose: "Inspect invoice 42"
};
function proposalCardFixture(input: unknown) {
  const plan = externalProposalToActionPlan(externalProposalSchema.parse(input), proposalEvaluationTime);
  const data: WorkflowView = {
    kind: "review", mode: "review", allowedActions: ["cancel"], actionRemainingMs: 1000, observe: false,
    progress: { status: "idle" }, walletAvailability: { status: "available", walletRunId: "00000000-0000-4000-8000-000000000001" }, connections: [], boundary: REVIEW_BOUNDARY,
    review: { reviewSessionId: "external-review", plan, reviewRevision: 0, status: "proposed", preparing: false }
  };
  return { plan, snapshot: state("review", { data }) };
}
function openDetails(node: Element): void {
  for (const item of node.querySelectorAll("details")) { item.open = true; item.dispatchEvent(new Event("toggle")); }
}

it("preserves declared payment facts without requiring a wallet or duplicating preview amounts", () => {
  const { snapshot } = proposalCardFixture({ ...proposalBase, type: "payment", payment: {
    amount: { amountDisplay: "123.4500", denomination: "USD" }, recipient: { label: "Invoice recipient", address: proposalRecipient }, target: "invoice-42"
  } });
  const data = workflowViewSchema.parse(snapshot.data);
  data.walletAvailability = { status: "unavailable", reason: "restoration_failed", message: "Wallet state cannot be checked." };
  const act = vi.fn(), rendered = reviewRenderer.result({ ...snapshot, data }, undefined, act), node = rendered.node as unknown as Element;
  openDetails(node);
  expect(node.querySelectorAll("h2").map((item) => item.textContent)).toEqual(["External proposal — view only"]);
  expect(factValues(node, "Source")).toEqual(["Invoice assistant"]);
  expect(factValues(node, "Source kind")).toEqual(["AI client"]);
  expect(factValues(node, "Source reference")).toEqual(["https://example.com/invoice/42"]);
  expect(node.querySelectorAll("a")).toHaveLength(0);
  expect(factValues(node, "Action")).toEqual(["Payment"]);
  expect(factValues(node, "Purpose")).toEqual(["Inspect invoice 42"]);
  expect(factValues(node, "Declared network").filter((value) => value === "sui:mainnet")).toEqual(["sui:mainnet"]);
  expect(factValues(node, "Proposed recipient")).toEqual([`Invoice recipient · ${proposalRecipient}`]);
  expect(factValues(node, "Proposed target")).toEqual(["invoice-42"]);
  expect(factValues(node, "Proposed send")).toEqual(["123.4500 (denomination: USD)"]);
  expect(factValues(node, "Proposed receive")).toEqual([]);
  expect(factValues(node, "Proposed fee")).toEqual([]);
  expect(node.textContent).not.toContain("Requested send");
  expect(node.textContent).not.toContain("Account to review");
  expect(node.textContent).not.toContain("private-proposal-record");
  expect(node.textContent).not.toContain("rejectedExecutableFields");
  expect(node.querySelectorAll("pre")).toHaveLength(0);
  expect(node.textContent).toContain("You cannot request wallet approval or submit a transaction from this proposal.");
  expect(node.textContent).toContain("Choose settlement asset");
  expect(node.textContent).toContain("not connected-chain verification");
  expect(node.querySelectorAll("button").map((item) => item.dataset.cardAction)).toEqual([]);
  expect(act).not.toHaveBeenCalled(); rendered.dispose();
});

it("renders Sui action targets, recipients and fees from the actual proposal model once", async () => {
  const { snapshot, plan } = proposalCardFixture({ ...proposalBase, type: "sui_action", action: {
    actionKind: "inspect_transfer", target: { label: "Treasury action", packageId: "0x2", module: "treasury", function: "release", objectId: "0x123" },
    recipient: { label: "Treasury", address: proposalRecipient }, assetFlow: [
      { direction: "outgoing", amount: { amountDisplay: "1", symbol: "SUI", denomination: "USD", coinType: "0x2::sui::SUI" }, recipient: { label: "Invoice recipient", address: proposalRecipient } },
      { direction: "expected_incoming", amount: { amountDisplay: "2.50", symbol: "DEEP" }, recipient: { label: "Return recipient" } },
      { direction: "fee", amount: { amountDisplay: "0.019876", symbol: "SUI" } }
    ]
  } });
  const data = workflowViewSchema.parse(snapshot.data), review = data.review!;
  review.state = await computeReviewState({ reviewSessionId: review.reviewSessionId, plan, account: proposalRecipient, now: proposalEvaluationTime });
  review.status = review.state.status;
  const act = vi.fn(), rendered = reviewRenderer.result({ ...snapshot, data }, undefined, act), node = rendered.node as unknown as Element;
  openDetails(node);
  expect(factValues(node, "Action")).toEqual(["Sui action"]);
  expect(node.textContent).toContain("Review Sui action proposal: inspect_transfer");
  expect(factValues(node, "Proposed target")).toEqual(["Treasury action"]);
  expect(factValues(node, "Package")).toEqual(["0x2"]);
  expect(factValues(node, "Module")).toEqual(["treasury"]);
  expect(factValues(node, "Function")).toEqual(["release"]);
  expect(factValues(node, "Object")).toEqual(["0x123"]);
  expect(factValues(node, "Proposed recipient")).toEqual([`Treasury · ${proposalRecipient}`, `Invoice recipient · ${proposalRecipient}`, "Return recipient"]);
  expect(factValues(node, "Proposed send")[0]).toContain("1 SUI (denomination: USD)");
  expect(factValues(node, "Proposed send")).toHaveLength(1);
  expect(factValues(node, "Declared asset · SUI")).toEqual(["0x2::sui::SUI"]);
  expect(factValues(node, "Proposed receive")).toEqual(["2.50 DEEP"]);
  expect(factValues(node, "Proposed fee")).toEqual(["0.019876 SUI"]);
  expect(node.textContent).not.toContain("Requested send");
  expect(factValues(node, "Proposal created")[0]).toContain("2029-12-31 23:00:00 UTC");
  expect(factValues(node, "Proposal expires")[0]).toContain("2030-01-01 01:23:45 UTC");
  expect(factValues(node, "Evaluated at")[0]).toContain("2030-01-01 00:00:00 UTC");
  const decision = node.querySelectorAll("div").find((item) => item.className === "workflow-decision")!;
  expect(decision.textContent.split("Declared network:")).toHaveLength(2);
  expect(decision.textContent.split("Non-signable review:")).toHaveLength(2);
  const passed = node.querySelectorAll("div").find((item) => item.children[0]?.tagName === "H3" && item.children[0].textContent === "Passed proposal checks")!;
  expect(factValues(passed, "External proposal contract")).toEqual(["The proposal contains the required information in the expected format. This does not verify its claims or permit a transaction."]);
  expect(factValues(passed, "Proposal freshness")).toEqual(["The proposal timestamps are current for this local review."]);
  const previous = node.textContent;
  for (const detail of node.querySelectorAll("details")) { detail.open = false; detail.dispatchEvent(new Event("toggle")); }
  openDetails(node); expect(node.textContent).toBe(previous);
  expect(node.querySelectorAll("button").map((item) => item.dataset.cardAction)).toEqual([]);
  expect(act).not.toHaveBeenCalled(); rendered.dispose(); openDetails(node); expect(act).not.toHaveBeenCalled();
});

it.each([
  ["2029-12-31T23:00:00.000Z", "2030-01-01T00:00:01.000Z", "Current at evaluation"],
  ["2029-12-31T23:00:00.000Z", "2030-01-01T00:00:00.000Z", "Expired at evaluation"],
  ["2030-01-01T00:00:01.000Z", "2030-01-01T01:00:00.000Z", "Created after evaluation time"],
  ["2029-12-31T23:00:00.000Z", undefined, "Expiry not provided"]
])("keeps proposal freshness evaluated from %s / %s as %s", (createdAt, expiresAt, label) => {
  // Evaluation is fixed at midnight 2030; the View's current clock is unrelated.
  vi.setSystemTime(new Date("2040-01-01T00:00:00.000Z"));
  const { snapshot } = proposalCardFixture({ ...proposalBase, createdAt, expiresAt, source: { kind: "user", name: "Chat" }, type: "sui_action",
    action: { actionKind: "inspect", target: { objectId: "0x456" } } });
  const rendered = reviewRenderer.result(snapshot, undefined, undefined), node = rendered.node as unknown as Element;
  openDetails(node);
  expect(factValues(node, "Declared timing")).toEqual([label]);
  expect(factValues(node, "Source reference")).toEqual([]);
  expect(factValues(node, "Module")).toEqual([]);
  expect(factValues(node, "Declared coin type")).toEqual([]);
  expect(factValues(node, "Proposed send")).toEqual([]);
  expect(factValues(node, "Proposal expires")).toEqual(expiresAt ? expect.arrayContaining([expect.stringContaining("2030-01-01")]) : ["Not provided"]);
  expect(factValues(node, "Object")).toEqual(["0x456"]);
  expect(node.textContent).not.toContain("undefined"); rendered.dispose();
});

it("keeps current review checks authoritative over copied proposal checks", async () => {
  const { snapshot, plan } = proposalCardFixture({ ...proposalBase, type: "payment", payment: { amount: { amountDisplay: "1", symbol: "SUI" }, recipient: { address: proposalRecipient } } });
  const data = workflowViewSchema.parse(snapshot.data), review = data.review!;
  review.state = await computeReviewState({ reviewSessionId: review.reviewSessionId, plan, account: proposalRecipient, now: proposalEvaluationTime });
  // A schema-valid empty current list is authoritative, not a request to fall back.
  review.state.checks = []; review.error = "Earlier review message: Evidence could not be refreshed.";
  const rendered = reviewRenderer.result({ ...snapshot, data }, undefined, undefined), node = rendered.node as unknown as Element;
  openDetails(node);
  const decision = node.querySelectorAll("div").find((item) => item.className === "workflow-decision")!;
  expect(decision.textContent).not.toContain("Declared network:");
  expect(decision.textContent).not.toContain("Non-signable review:");
  expect(decision.textContent).toContain("Earlier review message: Evidence could not be refreshed.");
  expect(node.textContent).not.toContain("The proposal contains the required information in the expected format. This does not verify its claims or permit a transaction.");
  expect(node.textContent).toContain("You cannot request wallet approval or submit a transaction from this proposal."); rendered.dispose();
});

it("owns missing wallet guidance per permitted action without blocking the other action", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
    const otherAccount = `0x${"d".repeat(64)}`;
    const scenarios = [
      { name: "both empty", connections: [], activeAccount: f.account, hints: ["No connected wallet is available for this transaction."], actions: [] },
      { name: "only signing empty", connections: [{ ...connection, methods: [] }], activeAccount: f.account, defaultAvailable: true, hints: ["No connected wallet is available for this transaction."], actions: ["prepare_review"] },
      { name: "only preparation empty", connections: [connection], activeAccount: otherAccount, hints: [], actions: ["request_signature"] },
      { name: "different accounts empty", connections: [], activeAccount: otherAccount, hints: ["No connected wallet is available for this transaction."], actions: [] },
      { name: "wallet unavailable", connections: [], activeAccount: f.account, unavailable: true, hints: [], actions: [] },
      { name: "neither permitted", connections: [], activeAccount: f.account, permitted: [], hints: [], actions: [] },
      { name: "preparation alone", connections: [], activeAccount: f.account, permitted: ["prepare_review"] as const, hints: [], actions: [] },
      { name: "signing alone", connections: [], activeAccount: f.account, permitted: ["request_signature"] as const, hints: ["No connected wallet is available for this transaction."], actions: [] }
    ];
    for (const scenario of scenarios) {
      const data = workflowViewSchema.parse(structuredClone(card.snapshot.data));
      data.connections = scenario.connections; data.activeAccount = scenario.activeAccount;
      // Publish coherent backend facts, not a changed row list with the old
      // default still marked usable. An unqualified stored address no longer
      // establishes a preparation target; a bound signature remains separate.
      data.usableConnectionId = !scenario.unavailable && scenario.connections.length ? connection.connectionId : undefined;
      data.assetReadAccount = scenario.defaultAvailable ? { status: "available", account: f.account } : { status: "address_required" };
      if (scenario.permitted) data.allowedActions = [...scenario.permitted];
      if (scenario.unavailable) data.walletAvailability = { status: "unavailable", reason: "restoration_failed", message: "Wallet state cannot be checked." };
      const act = vi.fn(), rendered = reviewRenderer.result({ ...card.snapshot, data }, undefined, act), node = rendered.node as unknown as Element;
      expect(node.querySelectorAll("p").filter((item) => /^(No wallet connection|No connected wallet)/.test(item.textContent)).map((item) => item.textContent), scenario.name).toEqual(scenario.hints);
      const controls = node.querySelectorAll("button").filter((item) => ["prepare_review", "request_signature"].includes(item.dataset.cardAction ?? ""));
      expect(controls.map((item) => item.dataset.cardAction), scenario.name).toEqual(scenario.actions);
      expect(act).not.toHaveBeenCalled();
      for (const control of controls) {
        control.click();
        expect(act).toHaveBeenLastCalledWith({ action: control.dataset.cardAction, walletRunId: f.runtime.runId, connectionId: connection.connectionId, account: f.account, reviewRevision: 1 });
      }
      const calls = act.mock.calls.length; rendered.dispose(); for (const control of controls) control.click(); expect(act).toHaveBeenCalledTimes(calls);
    }
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  } finally { f.close(); }
});

// Public resource responses deliberately carry no input permission. These
// fixtures exercise the actual lifecycle; workflow cases below use real MCP/DB.
function savedResource(snapshot: CardSnapshot, uri = CARD_RESOURCE_PREFIX + snapshot.cardId) {
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(snapshot) }] };
}

it.each(["account", "receipt", "chart"] as const)("restores %s through a public read even when an old snapshot exists", async (kind) => {
  const before = state(kind), completed = state(kind, { state: "closed", reason: "completed", revision: 2, data: { value: "saved" } });
  for (const creating of [before, completed]) {
    root = new Element("main");
    const app = host(async () => { throw new Error("No authorized tool call is permitted"); });
    app.readServerResource.mockResolvedValue(savedResource(completed));
    startCard(kind, renderer); app.ontoolresult!(result(creating)); app.ontoolresult!(result(creating));
    await vi.waitFor(() => expect(root.textContent).toContain("Stored result"));
    expect(app.readServerResource).toHaveBeenCalledExactlyOnceWith({ uri: CARD_RESOURCE_PREFIX + before.cardId }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(app.callServerTool).not.toHaveBeenCalled(); expect(submitButton()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000); expect(app.readServerResource).toHaveBeenCalledOnce();
    await app.onteardown!();
  }
});

it.each(["resource_link", "claude_text"] as const)("restores a missing snapshot from a %s without granting input authority", async (format) => {
  const completed = state("account", { state: "closed", reason: "completed", data: {} });
  const uri = CARD_RESOURCE_PREFIX + completed.cardId;
  const app = host(async () => { throw new Error("No input authority"); });
  app.readServerResource.mockResolvedValue(savedResource(completed));
  const content: CallToolResult["content"] = format === "resource_link"
    ? [{ type: "resource_link", uri, name: `card_${completed.cardId}` }]
    : [{ type: "text", text: `[Resource link: card_${completed.cardId}] ${uri} (Saved data for this exact card.)` }];
  startCard("account", renderer); app.ontoolresult!({ content });
  await vi.waitFor(() => expect(root.textContent).toContain("Stored result"));
  expect(app.readServerResource).toHaveBeenCalledOnce(); expect(app.callServerTool).not.toHaveBeenCalled();
});

it.each([null, {}, { cardId: "fixture-card", permission: 5 }, { cardId: "different-card", permission: "fixture" }])(
  "does not treat malformed or conflicting permission %j as absent", async (metadata) => {
    const app = host(async () => { throw new Error("Must not call"); });
    startCard("account", renderer);
    app.ontoolresult!({ ...result(state("account")), _meta: { [CARD_METADATA_KEY]: metadata } });
    await vi.waitFor(() => expect(root.textContent).toMatch(/cannot accept actions with the access information|information does not match this card/));
    expect(app.readServerResource).not.toHaveBeenCalled(); expect(app.callServerTool).not.toHaveBeenCalled();
    expect(submitButton()).toBeUndefined();
  }
);

it("keeps rejected permissions on the authenticated path without a public fallback", async () => {
  const app = host(async () => { throw new Error("Card access is unavailable."); });
  startCard("account", renderer); app.ontoolresult!(result(state("account"), true));
  await vi.waitFor(() => expect(root.textContent).toContain("Card access is unavailable."));
  expect(app.callServerTool).toHaveBeenCalledOnce(); expect(app.readServerResource).not.toHaveBeenCalled();
  expect(submitButton()).toBeUndefined();
});

it.each(["different_link", "different_name", "query_in_link", "different_kind", "missing_identity"] as const)("rejects %s before reading a saved card", async (failure) => {
  const app = host(async () => { throw new Error("Must not call"); });
  const creating = result(state(failure === "different_kind" ? "chart" : "account"));
  if (failure === "missing_identity") { delete creating.structuredContent; }
  else if (failure !== "different_kind") creating.content = [{ type: "resource_link", name: failure === "different_name" ? "card_other" : "card_fixture-card",
    uri: CARD_RESOURCE_PREFIX + (failure === "different_link" ? "other" : failure === "query_in_link" ? "fixture-card?other=1" : "fixture-card") }];
  startCard("account", renderer); app.ontoolresult!(creating);
  await vi.waitFor(() => expect(root.textContent).toMatch(/could not be matched to one card|information does not match this card|data is unavailable/));
  expect(app.readServerResource).not.toHaveBeenCalled(); expect(app.callServerTool).not.toHaveBeenCalled();
});

it.each(["card", "kind", "input", "uri", "previous_uri", "json", "schema"] as const)("rejects a public saved response with invalid %s", async (failure) => {
  const initial = state("receipt", { state: "closed", reason: "completed", revision: 2, input: { digest: chainReceiptDigest }, data: {} });
  const reply = structuredClone(initial);
  if (failure === "card") reply.cardId = "other-card";
  if (failure === "kind") reply.kind = "account";
  if (failure === "input") reply.input.digest = "other-digest";
  const resource = savedResource(reply, failure === "uri" ? "suimcp://cards/other-card" : failure === "previous_uri" ? "sayurintent://cards/" + initial.cardId : CARD_RESOURCE_PREFIX + initial.cardId);
  if (failure === "json") resource.contents[0]!.text = "not json";
  if (failure === "schema") resource.contents[0]!.text = JSON.stringify({ cardId: initial.cardId });
  const app = host(async () => { throw new Error("No input authority"); });
  app.readServerResource.mockResolvedValue(resource);
  startCard("receipt", renderer); app.ontoolresult!(result(initial));
  await vi.waitFor(() => expect(app.readServerResource).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(0);
  expect(root.textContent).not.toContain("Stored result"); expect(submitButton()).toBeUndefined();
  expect(app.callServerTool).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000); expect(app.readServerResource).toHaveBeenCalledOnce();
});

it("coalesces public retries, preserves displayed facts after failure and ignores teardown replies", async () => {
  const pending = deferred<ReturnType<typeof savedResource>>();
  const current = state("review", { state: "running", revision: 2, data: { allowedActions: [], observe: true, nextStateReadAfterMs: 1 } });
  const rendered = vi.fn((...args: Parameters<CardRenderer["result"]>) => renderer.result(...args));
  const app = host(async () => { throw new Error("No input authority"); });
  app.readServerResource.mockRejectedValueOnce(new Error("Saved read unavailable"))
    .mockResolvedValueOnce(savedResource(current)).mockRejectedValueOnce(new Error("Temporary read failure"))
    .mockReturnValueOnce(pending.promise);
  startCard("review", { ...renderer, result: rendered }); app.ontoolresult!(result(state("review")));
  await vi.waitFor(() => expect(root.textContent).toContain("Saved read unavailable"));
  expect(root.textContent).toContain("Card status unavailable");
  expect(root.textContent).not.toContain("Opening card");
  const retry = () => root.querySelectorAll("button").find((button) => button.textContent === "Check status")!;
  retry().click(); retry().click();
  await vi.waitFor(() => expect(root.textContent).toContain("Stored result"));
  expect(app.readServerResource).toHaveBeenCalledTimes(2); expect(rendered.mock.calls[0]![2]).toBeUndefined();
  await vi.advanceTimersByTimeAsync(60_000); expect(app.readServerResource).toHaveBeenCalledTimes(2);
  retry().click(); await vi.waitFor(() => expect(root.textContent).toContain("Temporary read failure"));
  expect(root.textContent).toContain("Stored result");
  retry().click(); retry().click(); await vi.waitFor(() => expect(app.readServerResource).toHaveBeenCalledTimes(4));
  await app.onteardown!(); const beforeLateReply = root.textContent;
  pending.resolve(savedResource({ ...current, state: "closed", reason: "completed", revision: 3 }));
  await vi.advanceTimersByTimeAsync(0); expect(root.textContent).toBe(beforeLateReply);
  expect(app.callServerTool).not.toHaveBeenCalled();
});

async function savedWorkflowMcp(f: Awaited<ReturnType<typeof walletWorkflowFixture>>) {
  const server = new McpServer({ name: "saved-workflow-fixture", version: "1" });
  const deps = { cards: { store: f.cards }, activityStore: f.activity, workflow: f.workflow, logger: f.logger };
  registerReadCards(server, deps);
  const client = new Client({ name: "saved-card-view", version: "1" }, { capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { server, deps, client,
    create: (kind: "connect" | "review", input: Record<string, unknown>) => f.run(() => createWorkflowCard(server, deps, kind, input, kind === "review" ? { reviewSessionId: input.reviewSessionId } : undefined)),
    call: (request: { name: string; arguments: Record<string, unknown> }) => f.run(async () => CallToolResultSchema.parse(await client.callTool(request))),
    readResource: (input: { uri: string }) => f.run(() => client.readResource(input)),
    close: async () => { await client.close(); await server.close(); }
  };
}

it.each(["success", "failure"] as const)("restores the original completed Review with chain %s using SQLite, MCP and the real renderer", async (outcome) => {
  const f = await walletWorkflowFixture({ receiptDetails: true }); const mcp = await savedWorkflowMcp(f);
  try {
    const { connection } = await f.approve();
    const { session } = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    const creating = await mcp.create("review", { reviewSessionId: session.id });
    const ref = cardReferenceSchema.parse(creating._meta?.[CARD_METADATA_KEY]);
    const initial = (creating.structuredContent as { data: { card: CardSnapshot } }).data.card;
    expect(initial.state).toBe("ready");
    const prepare = await f.run(() => f.cards.act({ ...ref, revision: initial.revision, input: { action: "prepare_review", walletRunId: f.runtime.runId, connectionId: connection.connectionId, account: f.account, reviewRevision: 0 } }));
    expect(prepare.error).toBeUndefined();
    await vi.waitFor(() => expect(f.run(() => f.sessions.readReviewSession(session.id))?.status).toBe("ready_for_wallet_review"));
    const ready = await f.run(() => f.cards.read(ref));
    f.setChainOutcome(outcome);
    const admitted = await f.run(() => f.cards.act({ ...ref, revision: ready.snapshot.revision, input: { action: "request_signature", walletRunId: f.runtime.runId, connectionId: connection.connectionId, account: f.account, reviewRevision: 1 } }));
    expect(admitted.error).toBeUndefined();
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(session.id))?.execution?.status).toBe(outcome));
    const stored = f.run(() => f.records.currentRequest(session.id))!;
    const calls = () => [f.quote.mock.calls.length, f.sign.mock.calls.length, f.submit.mock.calls.length, f.chainRead.mock.calls.length, f.connect.mock.calls.length, vi.mocked(f.transport.disconnect).mock.calls.length];
    const before = calls();
    // Expiring the review must not erase or replace its already recorded result.
    f.advance(Date.parse(initial.expiresAt) - f.now().getTime() + 1);
    const { _meta, ...historical } = creating;
    for (let frame = 0; frame < 2; frame++) {
      root = new Element("main"); const app = host(mcp.call);
      app.readServerResource.mockImplementation(mcp.readResource);
      startCard("review", reviewRenderer); app.ontoolresult!(historical);
      await vi.waitFor(() => expect(root.textContent).toContain(outcome === "success" ? "Transaction succeeded on Sui" : "Transaction failed on Sui"));
      expect(root.textContent).not.toContain("input permission");
      expect(root.querySelectorAll("[data-card-action]")).toHaveLength(0);
      expect(app.readServerResource).toHaveBeenCalledOnce(); expect(app.callServerTool).not.toHaveBeenCalled();
      const publicResponse = await app.readServerResource.mock.results[0]!.value;
      expect(JSON.stringify(publicResponse)).not.toContain(ref.permission);
      const saved = JSON.parse(publicResponse.contents[0].text) as CardSnapshot;
      expect(saved).toMatchObject({ cardId: initial.cardId, state: "closed", reason: "completed", data: {
        request: { attemptId: stored.attemptId, transactionDigest: stored.transactionDigest, requestStatus: "completed", execution: { status: outcome } }, allowedActions: [] } });
      expect(f.run(() => f.sessions.readReviewSession(session.id))?.status).toBe("expired");
      await vi.advanceTimersByTimeAsync(30_000); expect(app.readServerResource).toHaveBeenCalledOnce();
      await app.onteardown!(); expect(calls()).toEqual(before);
    }
    expect(f.run(() => f.records.currentRequest(session.id))!.execution).toEqual(stored.execution);
  } finally { await mcp.close(); f.close(); }
});

it.each(["connected", "missing_sdk_session", "sdk_unavailable"] as const)("restores Connect as read-only while preserving backend evaluation for %s", async (mode) => {
  const f = await walletWorkflowFixture(); const mcp = await savedWorkflowMcp(f);
  try {
    const { connection } = await f.approve(); const creating = await mcp.create("connect", {});
    const ref = cardReferenceSchema.parse(creating._meta?.[CARD_METADATA_KEY]);
    const before = [f.connect.mock.calls.length, f.sign.mock.calls.length, f.submit.mock.calls.length, vi.mocked(f.transport.disconnect).mock.calls.length];
    if (mode === "missing_sdk_session") { vi.spyOn(f.transport, "session").mockReturnValue(undefined); f.observe(); }
    if (mode === "sdk_unavailable") { vi.spyOn(f.transport, "inspectAll").mockImplementation(() => { throw new Error("SDK session unavailable"); }); f.observe(); }
    const { _meta, ...historical } = creating; const app = host(mcp.call);
    app.readServerResource.mockImplementation(mcp.readResource);
    startCard("connect", connectRenderer); app.ontoolresult!(historical);
    await vi.waitFor(() => expect(root.textContent).toContain(mode === "missing_sdk_session" ? "No wallet connected" : "Wallet connected"));
    expect(root.querySelectorAll("[data-card-action]")).toHaveLength(0);
    expect(root.querySelectorAll("form")).toHaveLength(0);
    const stored = f.run(() => f.records.connection(connection.connectionId))!.connection;
    expect(stored.status).toBe(mode === "missing_sdk_session" ? "disconnected" : "connected");
    if (mode === "sdk_unavailable") expect(root.textContent).toContain("Last recorded status");
    expect([f.connect.mock.calls.length, f.sign.mock.calls.length, f.submit.mock.calls.length, vi.mocked(f.transport.disconnect).mock.calls.length]).toEqual(before);
    expect(app.callServerTool).not.toHaveBeenCalled();
    const publicResponse = await app.readServerResource.mock.results[0]!.value;
    expect(JSON.stringify(publicResponse)).not.toContain(ref.permission);
    await app.onteardown!();
  } finally { await mcp.close(); f.close(); }
});

it("shows a ready Review as public facts without restoring its allowed signing and preparation controls", async () => {
  const f = await walletWorkflowFixture(); const mcp = await savedWorkflowMcp(f);
  try {
    const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
    const before = [f.quote.mock.calls.length, f.sign.mock.calls.length, f.submit.mock.calls.length, f.chainRead.mock.calls.length];
    const app = host(mcp.call); app.readServerResource.mockImplementation(mcp.readResource);
    startCard("review", reviewRenderer); app.ontoolresult!(result(card.snapshot));
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    expect(root.textContent).toContain("View only"); expect(root.textContent).toContain("Minimum receive");
    expect(root.querySelectorAll("[data-card-action], form")).toHaveLength(0);
    const saved = JSON.parse((await app.readServerResource.mock.results[0]!.value).contents[0].text);
    expect(saved.data.allowedActions).toContain("request_signature"); // Backend facts were not rewritten to suppress the UI.
    expect(saved.data.allowedActions).toContain("prepare_review");
    await vi.advanceTimersByTimeAsync(60_000); expect(app.readServerResource).toHaveBeenCalledOnce();
    expect(app.callServerTool).not.toHaveBeenCalled();
    expect([f.quote.mock.calls.length, f.sign.mock.calls.length, f.submit.mock.calls.length, f.chainRead.mock.calls.length]).toEqual(before);
    await app.onteardown!();
  } finally { await mcp.close(); f.close(); }
});

it.each(["review", "attempt", "digest", "receipt_digest"] as const)("rejects %s mismatches inside a saved Review result", async (failure) => {
  const initial = state("review", { input: { reviewSessionId: "review-id", attemptId: "attempt-id", mode: "manage" } });
  const saved = { ...initial, state: "closed" as const, reason: "completed" as const, revision: 1, data: {
    review: { reviewSessionId: failure === "review" ? "other-review" : "review-id" },
    request: { reviewSessionId: "review-id", attemptId: "attempt-id", transactionDigest: "digest-a",
      execution: { reviewSessionId: "review-id", attemptId: failure === "attempt" ? "other-attempt" : "attempt-id", txDigest: failure === "digest" ? "digest-b" : "digest-a" } },
    ...(failure === "receipt_digest" ? { receipt: { status: "found", receipt: { txDigest: "digest-b" } } } : {})
  } };
  const app = host(async () => { throw new Error("No input authority"); });
  app.readServerResource.mockResolvedValue(savedResource(saved));
  startCard("review", renderer); app.ontoolresult!(result(initial));
  await vi.waitFor(() => expect(root.textContent).toContain("does not match the information requested in this card"));
  expect(root.textContent).not.toContain("Stored result"); expect(root.querySelectorAll("button")).toHaveLength(0);
  expect(app.callServerTool).not.toHaveBeenCalled();
});

it("automatically prepares and renews one live review through actual SQLite, then signs only on Request", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve();
    const created = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    const card = await f.run(() => f.cards.create("review", { reviewSessionId: created.session.id }));
    const app = host(async ({ name, arguments: args }) => f.run(async () => cardToolResult(name === CARD_TOOLS.read
      ? await f.cards.read(cardReferenceSchema.parse(args))
      : await f.cards.act(args as any))));
    startCard("review", reviewRenderer);
    app.ontoolresult!({ ...result(card.snapshot), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(f.quote).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    expect(root.textContent).not.toContain("Update review");
    expect(root.querySelectorAll("button").filter((item) => item.dataset.cardAction).map((item) => item.dataset.cardAction)).toEqual(["request_signature", "cancel"]);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    const first = f.run(() => f.sessions.readReviewSession(created.session.id))!;
    f.advance(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(f.quote).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    expect(f.run(() => f.sessions.readReviewSession(created.session.id))!.reviewRevision).toBe(first.reviewRevision + 1);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    const request = root.querySelectorAll("button").find((item) => item.dataset.cardAction === "request_signature")!;
    request.click();
    await vi.waitFor(() => expect(f.sign).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.submit).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(root.textContent).toContain("Transaction succeeded on Sui"));
    const calls = app.callServerTool.mock.calls.length;
    f.advance(60_000); await vi.advanceTimersByTimeAsync(60_000);
    expect(app.callServerTool).toHaveBeenCalledTimes(calls);
    expect(f.quote).toHaveBeenCalledTimes(2); expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce();
    expect(connection.accounts).toContain(f.account);
    await app.onteardown!();
  } finally { f.close(); }
});

it.each(["success", "calculation_failure", "read_failure", "delivery_failure"] as const)("keeps the request and its feedback together during renewal: %s", async (outcome) => {
  const f = await walletWorkflowFixture();
  const readGate = deferred<void>(), calculation = deferred<Awaited<ReturnType<typeof f.quote>>>();
  let deferRead = false;
  try {
    const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
    const quote = f.quote.getMockImplementation()!;
    f.quote.mockImplementationOnce(() => calculation.promise);
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.read && deferRead) {
        deferRead = false; await readGate.promise;
        if (outcome === "read_failure") throw new Error("Saved review could not be read.");
      }
      if (name === CARD_TOOLS.act && outcome === "delivery_failure") throw new Error("Review update could not be delivered.");
      return f.run(async () => cardToolResult(name === CARD_TOOLS.read ? await f.cards.read(cardReferenceSchema.parse(args)) : await f.cards.act(args as any)));
    });
    const request = () => root.querySelector(".review-primary-action")!;
    const slot = () => root.querySelector(".review-primary-slot")!;
    const visibleActions = () => slot().querySelectorAll("button").filter((item) => !item.hidden);
    const feedback = () => root.querySelector(".review-action-feedback")!;
    const secondsLeft = () => { const match = /Review expires in (\d+):(\d+)/.exec(root.querySelector(".review-time-remaining")!.textContent)!; return Number(match[1]) * 60 + Number(match[2]); };
    startCard("review", reviewRenderer);
    app.ontoolresult!({ ...result(card.snapshot), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(request()?.disabled).toBe(false));
    const graph = root.querySelector(".ui-ptb-graph")!, shownFacts = root.querySelector(".review-material-facts")!.children[0];
    expect(request().textContent).toBe("Request wallet approval");
    expect(root.querySelector(".card-progress-hint")?.hidden).toBe(true);
    expect(root.querySelector(".review-time-remaining")!.textContent).toContain("Review expires in");
    expect(root.querySelector(".review-action-row")!.children[0]).toBe(slot());
    expect(root.querySelector(".review-action-row")!.children[1]!.getAttribute("aria-label")).toBe("Cancel review");
    const firstRevision = (card.snapshot.data as WorkflowView).review!.reviewRevision;
    const nextRead = (card.snapshot.data as WorkflowView).nextStateReadAfterMs!;
    deferRead = true; f.advance(nextRead); await vi.advanceTimersByTimeAsync(nextRead);
    expect(request().disabled).toBe(true);
    expect(request().textContent).toBe("Request wallet approval");
    expect(root.querySelector(".card-progress-hint")!.textContent).toBe("Checking status…");
    expect(root.querySelector(".ui-ptb-graph")).toBe(graph);
    expect(root.querySelector(".review-material-facts")!.children[0]).toBe(shownFacts);
    expect(root.querySelector(".review-material-status")!.textContent).toBe("Previous estimates · not current");
    request().click(); expect(f.sign).not.toHaveBeenCalled();
    readGate.resolve(); await vi.advanceTimersByTimeAsync(1);
    if (outcome === "read_failure" || outcome === "delivery_failure") {
      await vi.waitFor(() => expect(feedback().textContent).toContain(outcome === "read_failure" ? "Saved review could not be read." : "Review update could not be delivered."));
      expect(root.querySelector(".card-progress-hint")?.hidden).toBe(true);
      expect(root.querySelectorAll("button").some((item) => item.textContent === (outcome === "read_failure" ? "Check status" : "Retry review") && !item.disabled)).toBe(true);
      expect(request().disabled).toBe(true);
      expect(request().hidden).toBe(true);
      expect(visibleActions()).toHaveLength(1);
      expect(visibleActions()[0]!.textContent).toBe(outcome === "read_failure" ? "Check status" : "Retry review");
      expect((visibleActions()[0] as unknown as HTMLButtonElement).type).toBe("button");
      const left = secondsLeft(), calls = app.callServerTool.mock.calls.length;
      await vi.advanceTimersByTimeAsync(2000);
      expect(secondsLeft()).toBeLessThanOrEqual(left - 2);
      expect(app.callServerTool).toHaveBeenCalledTimes(calls);
    } else {
      await vi.waitFor(() => expect(f.quote).toHaveBeenCalledTimes(2));
      expect(request().disabled).toBe(true);
      expect(root.querySelector(".card-progress-hint")!.textContent).toBe("Updating review…");
      expect(root.querySelector(".ui-ptb-graph")).toBe(graph);
      expect(root.querySelector(".review-material-facts")!.children[0]).toBe(shownFacts);
      expect(root.textContent).not.toContain("These review details are no longer current.");
      if (outcome === "success") {
        const nextQuote = await quote();
        // Independent synthetic source: 246913578 raw units at 6 decimals.
        nextQuote.rawQuote.directionalOutput.raw = "246913578";
        nextQuote.rawQuote.quoteOut.raw = "246913578";
        nextQuote.quote.quoteOut = "246.913578";
        calculation.resolve(nextQuote);
      }
      else calculation.reject(new Error("Fixture quote source unavailable"));
      await vi.advanceTimersByTimeAsync(3000);
      if (outcome === "success") {
        await vi.waitFor(() => expect(request().disabled).toBe(false));
        expect(root.querySelector(".card-progress-hint")?.hidden).toBe(true);
    expect(root.querySelector(".review-time-remaining")!.textContent).toContain("Review expires in");
        expect(root.textContent).not.toContain("Next condition check in");
        expect((await f.read(card)).snapshot.data).toMatchObject({ review: { reviewRevision: firstRevision + 1 } });
        expect(root.querySelector(".ui-ptb-graph")).toBe(graph);
        expect(root.querySelector(".review-material-status")!.textContent).toBe("Current estimates");
        expect(root.querySelector(".review-material-facts")!.textContent).toContain("246.913578 USDC");
      } else {
        await vi.waitFor(() => expect(root.textContent).toContain("Retry review"));
        expect(request().disabled).toBe(false);
        expect(request().textContent).toBe("Retry review");
        expect(visibleActions()).toHaveLength(1);
        expect(root.querySelectorAll("button").filter((item) => !item.hidden && item.textContent === "Request wallet approval")).toHaveLength(0);
        expect(feedback().textContent).toContain("Fixture quote source unavailable");
        expect(root.querySelector(".card-progress-hint")?.hidden).toBe(true);
        expect(root.querySelector(".ui-ptb-graph")).toBe(graph);
        expect(root.querySelector(".review-material-status")!.textContent).toBe("Previous estimates · not current");
        await vi.advanceTimersByTimeAsync(60_000); expect(f.quote).toHaveBeenCalledTimes(2);
        const beforeRetry = secondsLeft();
        request().click();
        await vi.waitFor(() => expect(f.quote).toHaveBeenCalledTimes(3));
        await vi.advanceTimersByTimeAsync(3000);
        await vi.waitFor(() => expect(request().textContent).toBe("Request wallet approval"));
        expect(request().disabled).toBe(false);
        expect(secondsLeft()).toBeLessThanOrEqual(beforeRetry);
      }
    }
    if (outcome === "success" || outcome === "calculation_failure") expect(request().textContent).toBe("Request wallet approval");
    expect(visibleActions()).toHaveLength(1);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
  } finally { readGate.resolve(); f.close(); }
});

it.each(["expiry", "cancel"] as const)("keeps one original review lifetime through renewal and ends input by %s", async (end) => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
    if (end === "expiry") vi.setSystemTime(new Date("2040-01-01T00:00:00.000Z"));
    const app = host(async ({ name, arguments: args }) => f.run(async () => cardToolResult(name === CARD_TOOLS.read
      ? await f.cards.read(cardReferenceSchema.parse(args)) : await f.cards.act(args as any))));
    startCard("review", reviewRenderer);
    app.ontoolresult!({ ...result(card.snapshot), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    const remaining = () => root.querySelector(".review-time-remaining")!.textContent;
    const cancel = () => root.querySelectorAll("button").find((item) => item.dataset.cardAction === "cancel")!;
    const secondsLeft = () => { const match = /Review expires in (\d+):(\d+)/.exec(remaining())!; return Number(match[1]) * 60 + Number(match[2]); };
    await vi.waitFor(() => expect(remaining()).toContain("Review expires in"));
    const initial = secondsLeft();
    expect(initial).toBe(30 * 60);
    expect(cancel().disabled).toBe(false); expect(cancel().className).toContain("ui-btn--danger");
    expect(root.querySelectorAll("button").filter((item) => item.dataset.cardAction === "cancel")).toHaveLength(1);
    f.advance(30_000); await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(f.quote).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(3000);
    expect(secondsLeft()).toBeLessThanOrEqual(initial - 30);
    expect((await f.read(card)).snapshot.expiresAt).toBe(card.snapshot.expiresAt);
    if (end === "cancel") {
      cancel().click();
      await vi.waitFor(async () => expect((await f.read(card)).snapshot).toMatchObject({ state: "closed", reason: "cancelled" }));
    } else {
      const elapsed = Date.parse(card.snapshot.expiresAt) - f.now().getTime() + 1;
      f.advance(elapsed); await vi.advanceTimersByTimeAsync(elapsed);
      await vi.waitFor(async () => expect((await f.read(card)).snapshot).toMatchObject({ state: "closed", reason: "expired" }));
    }
    await vi.waitFor(() => expect(root.querySelector(".review-time-remaining")).toBeUndefined());
    expect(root.querySelectorAll("[data-card-action]")).toHaveLength(0);
    const calls = app.callServerTool.mock.calls.length, quotes = f.quote.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.callServerTool).toHaveBeenCalledTimes(calls); expect(f.quote).toHaveBeenCalledTimes(quotes);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
  } finally { f.close(); }
});

it.each(["success", "failure", "dispose"] as const)("stages changed review diagrams with their facts and releases late renders: %s", async (outcome) => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
    const act = vi.fn(), changed = vi.fn(), view = reviewRenderer.controls(card.snapshot, act, undefined, undefined, { automaticPaused: false, onDisplayChange: changed });
    if (!("update" in view)) throw new Error("Expected the live review presentation.");
    const node = view.node as unknown as Element;
    await Promise.resolve(); await Promise.resolve();
    const oldGraph = node.querySelector(".ui-ptb-graph")!, oldFacts = node.querySelector(".review-material-facts")!.children[0];
    const next = structuredClone(card.snapshot), data = next.data as WorkflowView;
    next.revision += 1; data.review!.reviewRevision += 1;
    // A changed, valid display artifact. Only Mermaid drawing is delayed; all
    // renderer state, selection binding and disposal code remains real.
    data.review!.state!.ptbVisualization!.mermaid.namedText += `\n%% changed-display-${outcome}`;
    const gate = deferred<{ svg: string }>(), mermaid = (await import("mermaid")).default;
    vi.mocked(mermaid.render).mockImplementationOnce(() => gate.promise as any);
    expect(view.update!(next, { automaticPaused: false, onDisplayChange: changed })).toBe(true);
    expect(view.pending!()).toBe(true);
    expect(node.querySelector(".ui-ptb-graph")).toBe(oldGraph);
    expect(node.querySelector(".review-material-facts")!.children[0]).toBe(oldFacts);
    expect(node.querySelector(".review-primary-action")!.disabled).toBe(true);
    node.querySelector(".review-primary-action")!.click(); expect(act).not.toHaveBeenCalled();
    if (outcome === "success") {
      // An address-mode render can supersede drawing without leaving the
      // owner's pending presentation permanently locked.
      node.querySelectorAll("button").find((item) => item.getAttribute("aria-label") === "Show full addresses")!.click();
    }
    if (outcome === "dispose") view.dispose();
    if (outcome === "failure") gate.reject(new Error("Fixture diagram failure")); else gate.resolve({ svg: "<svg>updated fixture graph</svg>" });
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(outcome === "dispose" ? 0 : 1));
    if (outcome !== "dispose") {
      await vi.waitFor(() => expect(view.pending!()).toBe(false));
      expect(node.querySelector(".review-material-facts")!.children[0]).not.toBe(oldFacts);
      if (outcome === "failure") expect(node.textContent).toContain("Fixture diagram failure");
      node.querySelector(".review-primary-action")!.click();
      expect(act).toHaveBeenCalledExactlyOnceWith({ action: "request_signature", walletRunId: f.runtime.runId, connectionId: connection.connectionId, account: f.account, reviewRevision: 2 });
      if (outcome === "failure") {
        const recovered = structuredClone(card.snapshot);
        recovered.revision += 2; (recovered.data as WorkflowView).review!.reviewRevision = 3;
        expect(view.update!(recovered, { automaticPaused: false, onDisplayChange: changed })).toBe(true);
        await vi.waitFor(() => expect(view.pending!()).toBe(false));
        expect(node.querySelector(".ui-ptb-graph")!.className).not.toContain("ui-ptb-graph--error");
      }
    } else {
      await Promise.resolve(); await Promise.resolve();
      expect(node.querySelector(".review-material-facts")!.children[0]).toBe(oldFacts);
      expect(act).not.toHaveBeenCalled();
    }
    view.dispose(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  } finally { f.close(); }
});

it.each(["account", "plan", "session", "request"] as const)("does not retain a live review across a different %s", async (boundary) => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
    const view = reviewRenderer.controls(card.snapshot, vi.fn(), undefined);
    if (!("update" in view)) throw new Error("Expected the live review presentation.");
    const next = structuredClone(card.snapshot), data = next.data as WorkflowView;
    if (boundary === "account") data.review!.account = `0x${"b".repeat(64)}`;
    if (boundary === "plan") data.review!.plan.id = "different-plan";
    if (boundary === "session") data.review!.reviewSessionId = "different-session";
    if (boundary === "request") {
      await f.act(card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: data.review!.reviewRevision });
      next.data = (await f.read(card)).snapshot.data;
    }
    expect(view.update!(next, { automaticPaused: false })).toBe(false);
    view.dispose();
  } finally { f.close(); }
});

it("replaces unbound presentation when preparation binds the same displayed account", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve();
    const { session } = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    const card = await f.run(() => f.cards.create("review", { reviewSessionId: session.id }));
    const before = workflowViewSchema.parse(card.snapshot.data);
    expect(before.review!.account).toBeUndefined(); expect(before.activeAccount).toBe(f.account);
    const view = reviewRenderer.controls(card.snapshot, vi.fn(), undefined);
    if (!("update" in view)) throw new Error("Expected the live review presentation.");
    expect((await f.act(card, { action: "prepare_review", account: f.account, connectionId: connection.connectionId, reviewRevision: 0 })).error).toBeUndefined();
    await vi.waitFor(() => expect(f.run(() => f.sessions.readReviewSession(session.id))?.status).toBe("ready_for_wallet_review"));
    const current = await f.read(card);
    expect(workflowViewSchema.parse(current.snapshot.data).review!.account).toBe(f.account);
    expect(view.update!(current.snapshot, { automaticPaused: false })).toBe(false);
    view.dispose(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  } finally { f.close(); }
});

it("does not automatically repeat a failed preparation or act on public saved views", async () => {
  const f = await walletWorkflowFixture();
  try {
    await f.approve(); f.quote.mockRejectedValue(new Error("fixture quote unavailable"));
    const created = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    const card = await f.run(() => f.cards.create("review", { reviewSessionId: created.session.id }));
    const app = host(async ({ name, arguments: args }) => f.run(async () => cardToolResult(name === CARD_TOOLS.read
      ? await f.cards.read(cardReferenceSchema.parse(args)) : await f.cards.act(args as any))));
    startCard("review", reviewRenderer); app.ontoolresult!({ ...result(card.snapshot), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(f.quote).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(root.textContent).toContain("Retry review"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.quote).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
    const readonly = host(async () => { throw new Error("Public replay must never call a tool"); });
    readonly.readServerResource.mockImplementation(async ({ uri }) => ({ contents: [{ uri, text: JSON.stringify(await f.run(() => f.cards.readSaved(card.snapshot.cardId))) }] }));
    startCard("review", reviewRenderer); readonly.ontoolresult!(result(card.snapshot));
    await vi.waitFor(() => expect(readonly.readServerResource).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(readonly.callServerTool).not.toHaveBeenCalled(); expect(f.quote).toHaveBeenCalledOnce();
    expect(root.querySelectorAll("[data-card-action]")).toHaveLength(0);
    await readonly.onteardown!();
  } finally { f.close(); }
});

it("pauses automatic renewal while hidden and confirms current state before resuming", async () => {
  const f = await walletWorkflowFixture();
  const visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility);
  document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  try {
    await f.approve();
    const created = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    const card = await f.run(() => f.cards.create("review", { reviewSessionId: created.session.id }));
    const app = host(async ({ name, arguments: args }) => f.run(async () => cardToolResult(name === CARD_TOOLS.read
      ? await f.cards.read(cardReferenceSchema.parse(args)) : await f.cards.act(args as any))));
    startCard("review", reviewRenderer); app.ontoolresult!({ ...result(card.snapshot), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(f.quote).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", writable: true });
    visibility.dispatchEvent(new Event("visibilitychange"));
    const reads = app.callServerTool.mock.calls.length;
    f.advance(60_000); await vi.advanceTimersByTimeAsync(60_000);
    expect(app.callServerTool).toHaveBeenCalledTimes(reads); expect(f.quote).toHaveBeenCalledOnce();
    Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
    visibility.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(f.quote).toHaveBeenCalledTimes(2));
    expect(app.callServerTool.mock.calls[reads]?.[0].name).toBe(CARD_TOOLS.read);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
  } finally { f.close(); }
});

it("starts only a connect-intent QR and opens disconnect confirmation without sending a disconnect", async () => {
  const f = await walletWorkflowFixture();
  try {
    const card = await f.createConnection();
    const app = host(async ({ name, arguments: args }) => f.run(async () => cardToolResult(name === CARD_TOOLS.read
      ? await f.cards.read(cardReferenceSchema.parse(args)) : await f.cards.act(args as any))));
    startCard("connect", connectRenderer); app.ontoolresult!({ ...result(card.snapshot), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(f.connect).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.connect).toHaveBeenCalledOnce(); expect(f.transport.disconnect).not.toHaveBeenCalled();
    await app.onteardown!();
    f.approval.resolve({ topic: "fixture-topic", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet",
      expiresAt: new Date(f.now().getTime() + 1_800_000).toISOString(), walletName: "Fixture Wallet" });
    await vi.waitFor(() => expect(f.run(() => f.records.connections()[0]?.connection.status)).toBe("connected"));
    const disconnect = await f.run(() => f.cards.create("connect", { intent: "disconnect" }));
    const view = connectRenderer.result(disconnect.snapshot, undefined, vi.fn(), undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(view.node.textContent).toContain("Confirm disconnect");
    expect(view.node.textContent).toContain("Back");
    expect(f.transport.disconnect).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    view.dispose();
  } finally { f.close(); }
});

it("retains verified conditions and actions when the top graph cannot initialize", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
    const mermaid = (await import("mermaid")).default;
    document.documentElement.setAttribute("data-theme", "fixture-initialization-failure");
    vi.mocked(mermaid.initialize).mockImplementationOnce(() => { throw new Error("Fixture drawing failure"); });
    const view = reviewRenderer.result(card.snapshot, undefined, vi.fn());
    expect(view.node.textContent).toContain("The transaction graph could not be displayed");
    expect(view.node.textContent).toContain("Minimum received on success122.839505 USDC");
    expect(view.node.textContent).toContain("Ready for your review");
    expect([...view.node.querySelectorAll<HTMLButtonElement>('[data-card-action]')].map((item) => item.dataset.cardAction)).toEqual(["request_signature", "cancel"]);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    view.dispose();
  } finally { f.close(); }
});

it("rejects an injected automatic signature even when a display renderer accepts the snapshot", async () => {
  const snapshot = timedReview({ automaticAction: { action: "request_signature", connectionId: "wallet", account: `0x${"a".repeat(64)}`, reviewRevision: 0 } });
  const app = host(async () => result(snapshot));
  startCard("review", expiryRenderer); app.ontoolresult!(result(timedReview(), true));
  await vi.waitFor(() => expect(root.textContent).toContain("This card could not start the next step"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(app.callServerTool.mock.calls.every(([call]) => call.name === CARD_TOOLS.read)).toBe(true);
  expect(app.callServerTool).toHaveBeenCalledOnce();
});

it.each(["review", "connect"] as const)("pauses %s delivery errors across reads and visibility, and retries only explicitly", async (kind) => {
  const f = await walletWorkflowFixture();
  const visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility);
  document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  try {
    if (kind === "review") await f.approve();
    const session = kind === "review" ? await f.run(() => f.sessions.createReviewSession([f.plan], f.now())) : undefined;
    const card = await f.run(() => f.cards.create(kind, session ? { reviewSessionId: session.session.id } : { intent: "connect" }));
    let failure: "throw" | "envelope" | "none" = "throw";
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.act && failure === "throw") throw new Error("Fixture action delivery refused");
      if (name === CARD_TOOLS.act && failure === "envelope") return errorToolResult({ kind: "internal_error", details: { code: "card_unavailable", reason: "Fixture card operation unavailable" } });
      return f.run(async () => cardToolResult(name === CARD_TOOLS.read ? await f.cards.read(cardReferenceSchema.parse(args)) : await f.cards.act(args as any)));
    });
    startCard(kind, kind === "review" ? reviewRenderer : connectRenderer);
    app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    const acts = () => app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act);
    const retry = () => root.querySelectorAll("button").find((button) => button.textContent === (kind === "connect" ? "Retry connection" : "Retry review"));
    await vi.waitFor(() => expect(retry()).toBeDefined());
    expect(root.textContent).toContain("Fixture action delivery refused");
    expect(acts()).toHaveLength(1);
    expect(app.callServerTool.mock.calls.map(([call]) => call.name)).toEqual([CARD_TOOLS.read, CARD_TOOLS.act, CARD_TOOLS.read]);
    // An unrelated revision bump is not proof of command admission.
    f.run(() => { const row = f.cardRecords.get(card.snapshot.cardId)!; f.cardRecords.replace(row, { ...row, state: { ...row.state, revision: row.state.revision + 1 } }); });
    Object.defineProperty(document, "visibilityState", { value: "hidden", writable: true }); visibility.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 3);
    Object.defineProperty(document, "visibilityState", { value: "visible", writable: true }); visibility.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 3);
    expect(acts()).toHaveLength(1); expect(retry()?.disabled).toBe(false);
    failure = "envelope"; retry()!.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Fixture card operation unavailable"));
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 3);
    expect(acts()).toHaveLength(2); expect(retry()?.disabled).toBe(false);
    failure = "none"; retry()!.click();
    await vi.waitFor(() => expect(kind === "review" ? f.quote : f.connect).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs);
    expect(acts()).toHaveLength(3); expect(retry()).toBeUndefined();
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!(); await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 3);
    expect(acts()).toHaveLength(3);
  } finally { f.close(); }
});

it.each(["throw", "envelope", "typed"] as const)("stops %s action recovery when its read also fails, including hide/show", async (failure) => {
  const f = await walletWorkflowFixture();
  const visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility);
  document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  try {
    const card = await f.createConnection(); let reads = 0;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.act) {
        if (failure === "throw") throw new Error("Fixture lost command");
        if (failure === "typed") return cardToolResult({ ...await f.read(card), error: { code: "card_conflict", message: "Fixture command rejected" } });
        return errorToolResult({ kind: "internal_error", details: { code: "card_unavailable", reason: "Fixture action failed" } });
      }
      if (++reads === 2) throw new Error("Fixture recovery read failed");
      return cardToolResult(await f.run(() => f.cards.read(cardReferenceSchema.parse(args))));
    });
    startCard("connect", connectRenderer); app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(root.textContent).toContain("Fixture recovery read failed"));
    expect(root.textContent).not.toContain("Retry");
    const count = app.callServerTool.mock.calls.length;
    Object.defineProperty(document, "visibilityState", { value: "hidden", writable: true }); visibility.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", writable: true }); visibility.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 3);
    expect(app.callServerTool).toHaveBeenCalledTimes(count);
    root.querySelectorAll("button").find((button) => button.textContent === "Check status")!.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Retry"));
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
    expect(f.connect).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
  } finally { f.close(); }
});

it.each(["review", "connect"] as const)("observes an admitted %s after a lost action response without resending it", async (kind) => {
  const f = await walletWorkflowFixture();
  try {
    if (kind === "review") await f.approve();
    const session = kind === "review" ? await f.run(() => f.sessions.createReviewSession([f.plan], f.now())) : undefined;
    const card = await f.run(() => f.cards.create(kind, session ? { reviewSessionId: session.session.id } : { intent: "connect" }));
    const quote = deferred<Awaited<ReturnType<typeof f.quote>>>();
    const quoteValue = await f.quote(); f.quote.mockClear();
    if (kind === "review") f.quote.mockImplementationOnce(() => quote.promise);
    const app = host(async ({ name, arguments: args }) => {
      const response = await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any));
      if (name === CARD_TOOLS.act) throw new Error("Fixture admitted command reply lost");
      return cardToolResult(response);
    });
    startCard(kind, kind === "review" ? reviewRenderer : connectRenderer);
    app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(kind === "review" ? f.quote : f.connect).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 2);
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
    expect(root.querySelectorAll("button").some((button) => button.textContent === (kind === "connect" ? "Retry connection" : "Retry review"))).toBe(false);
    if (kind === "review") {
      quote.resolve(quoteValue);
      await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 2);
      await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
      expect(root.textContent).not.toContain("reply lost"); expect(f.quote).toHaveBeenCalledOnce();
    }
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { f.close(); }
});

it.each([false, true])("recovers an expired Request without repeating it (recovery read fails: %s)", async (failRead) => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card, session } = await f.prepare(connection.connectionId);
    let refused = false, readFailed = false;
    const app = host(async ({ name, arguments: args }) => {
      if (failRead && refused && !readFailed && name === CARD_TOOLS.read) { readFailed = true; throw new Error("Fixture state recovery unavailable"); }
      const response = await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any));
      if (name === CARD_TOOLS.act && response.error) refused = true;
      return cardToolResult(response);
    });
    startCard("review", reviewRenderer); app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    const expiry = Date.parse(session.reviewState!.humanReadableReview!.freshness.expiresAt!);
    // Backend time passes before the View receives its scheduled state read.
    f.advance(expiry - f.now().getTime());
    root.querySelectorAll("button").find((button) => button.dataset.cardAction === "request_signature")!.click();
    if (failRead) {
      await vi.waitFor(() => expect(root.textContent).toContain("Fixture state recovery unavailable"));
      await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 3);
      expect(f.quote).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled();
      root.querySelectorAll("button").find((button) => button.textContent === "Check status")!.click();
    }
    await vi.waitFor(() => expect(f.quote).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs);
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    const commands = app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act).map(([call]) => call.arguments.input);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({ action: "request_signature", reviewRevision: session.reviewRevision });
    expect(commands[1]).toMatchObject({ action: "prepare_review", reviewRevision: session.reviewRevision });
    expect(f.run(() => f.sessions.readReviewSession(session.id))!.reviewRevision).toBe(session.reviewRevision + 1);
    expect(root.querySelectorAll("button").filter((button) => button.dataset.cardAction === "request_signature")).toHaveLength(1);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { f.close(); }
});

it.each(["blocked", "refresh_required"] as const)("preserves a late %s computation after material expiry until explicit Retry", async (failure) => {
  const f = await walletWorkflowFixture();
  try {
    await f.approve();
    f.simulate.mockImplementation(() => { throw failure === "blocked" ? new Error("Fixture invalid simulation response") : Object.assign(new Error("Fixture endpoint unavailable"), { code: "UNAVAILABLE" }); });
    const created = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    const card = await f.run(() => f.cards.create("review", { reviewSessionId: created.session.id }));
    const app = host(async ({ name, arguments: args }) => cardToolResult(await f.run(() => name === CARD_TOOLS.read
      ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any))));
    startCard("review", reviewRenderer); app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(f.simulate).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs);
    const before = f.run(() => f.sessions.readReviewSession(created.session.id))!;
    expect(before.preparationId).toBeUndefined(); expect(before.status).toBe(failure);
    expect(before.reviewState).toMatchObject(failure === "blocked" ? { blockedReason: "object_resolution_failed" } : { refreshReason: "simulation_transient_failure" });
    expect(before.reviewState?.humanReadableReview).toBeDefined();
    expect(before.reviewState?.adapterLifecycle?.completedStages).toEqual(expect.arrayContaining(["transaction_material_build_or_verify", "digest_commitment", "object_ownership", "human_readable_review"]));
    const artifacts = f.run(() => f.activity.createPrivateReviewArtifactStore().get(created.session.id))!;
    expect(artifacts.transactionMaterial).toBeDefined(); expect(artifacts.humanReadableReview).toBeDefined();
    f.advance(Date.parse(artifacts.transactionMaterial!.expiresAt) - f.now().getTime());
    // Same-card state recovery is an ordinary read, never consent to retry.
    app.ontoolresult!(cardToolResult(card));
    await app.onteardown!();
    const restored = host(async ({ name, arguments: args }) => cardToolResult(await f.run(() => name === CARD_TOOLS.read
      ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any))));
    startCard("review", reviewRenderer); restored.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(root.textContent).toContain("Retry review"));
    const after = f.run(() => f.sessions.readReviewSession(created.session.id))!;
    expect(after.status).toBe(failure); expect(after.reviewState?.checks).toEqual(before.reviewState?.checks);
    expect(after.reviewState).toMatchObject({ evidenceValidity: "invalidated", adapterLifecycle: before.reviewState!.adapterLifecycle });
    expect(after.reviewState?.humanReadableReview).toBeUndefined(); expect(after.reviewState?.ptbVisualization).toBeUndefined();
    expect(f.run(() => f.activity.createPrivateReviewArtifactStore().get(created.session.id))).toBeUndefined();
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 3);
    expect(f.quote).toHaveBeenCalledOnce(); expect(f.simulate).toHaveBeenCalledOnce();
    expect(restored.callServerTool.mock.calls.every(([call]) => call.name === CARD_TOOLS.read)).toBe(true);
    root.querySelectorAll("button").find((button) => button.textContent === "Retry review")!.click();
    await vi.waitFor(() => expect(f.simulate).toHaveBeenCalledTimes(2));
    expect(f.quote).toHaveBeenCalledTimes(2); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await restored.onteardown!();
  } finally { f.close(); }
});

it.each(["undelivered", "rejected_reply_lost", "snapshotless_error"] as const)("recovers %s Request at material expiry without reusing the financial request", async (failure) => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card, session } = await f.prepare(connection.connectionId);
    let lostRequest: Parameters<typeof f.cards.act>[0] | undefined;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.act && (args.input as { action: string }).action === "request_signature") {
        lostRequest = args as Parameters<typeof f.cards.act>[0];
        if (failure === "rejected_reply_lost") expect((await f.run(() => f.cards.act(lostRequest!))).error?.code).toBe("card_conflict");
        if (failure === "snapshotless_error") return errorToolResult({ kind: "internal_error", details: { reason: "Fixture Request response unavailable" } });
        throw new Error("Fixture Request response unavailable");
      }
      return cardToolResult(await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any)));
    });
    startCard("review", reviewRenderer); app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    const remaining = Date.parse(session.reviewState!.humanReadableReview!.freshness.expiresAt) - f.now().getTime();
    if (failure === "rejected_reply_lost") f.advance(remaining);
    root.querySelectorAll("button").find((item) => item.dataset.cardAction === "request_signature")!.click();
    await vi.waitFor(() => expect(lostRequest).toBeDefined());
    if (failure !== "rejected_reply_lost") {
      await vi.waitFor(() => expect(root.textContent).toContain("Fixture Request response unavailable"));
      expect(f.quote).toHaveBeenCalledOnce();
      f.advance(remaining); await vi.advanceTimersByTimeAsync(remaining);
    }
    await vi.waitFor(() => expect(f.quote).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs);
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    expect(f.run(() => f.records.currentRequest(session.id))).toBeUndefined();
    expect(root.querySelectorAll("button").filter((item) => item.dataset.cardAction === "request_signature")).toHaveLength(1);
    // A delayed original command cannot acquire the newer review's authority.
    const late = await f.run(() => f.cards.act(lostRequest!)); expect(late.error?.code).toBe("card_conflict");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    expect(app.callServerTool.mock.calls.filter(([call]) => (call.arguments.input as any)?.action === "request_signature")).toHaveLength(1);
    expect(f.run(() => f.sessions.readReviewSession(session.id))!.reviewRevision).toBe(session.reviewRevision + 1);
    await app.onteardown!();
  } finally { f.close(); }
});

it("observes an admitted Request after a lost reply without preparing or signing again", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card, session } = await f.prepare(connection.connectionId);
    const app = host(async ({ name, arguments: args }) => {
      const response = await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any));
      if (name === CARD_TOOLS.act) throw new Error("Fixture admitted Request reply lost");
      return cardToolResult(response);
    });
    startCard("review", reviewRenderer); app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    root.querySelectorAll("button").find((item) => item.dataset.cardAction === "request_signature")!.click();
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(session.id))?.requestStatus).toBe("completed"));
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 2);
    expect(root.textContent).toContain("Transaction succeeded on Sui");
    expect(f.quote).toHaveBeenCalledOnce(); expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce();
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
    await app.onteardown!();
  } finally { f.close(); }
});

it.each(["account", "connection", "bound_connection"] as const)("offers the current preparation choice after failed delivery and %s change", async (mode) => {
  const f = await walletWorkflowFixture();
  const visibility = new EventTarget(); document.addEventListener = visibility.addEventListener.bind(visibility); document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  const show = (value: string) => { Object.defineProperty(document, "visibilityState", { value, writable: true }); visibility.dispatchEvent(new Event("visibilitychange")); };
  try {
    const { connection } = await f.approve();
    let card: Awaited<ReturnType<typeof f.cards.create>>;
    if (mode === "bound_connection") {
      const ready = await f.prepare(connection.connectionId); card = ready.card;
      f.advance(Date.parse(ready.session.reviewState!.humanReadableReview!.freshness.expiresAt) - f.now().getTime());
    } else {
      const { session } = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
      card = await f.run(() => f.cards.create("review", { reviewSessionId: session.id }));
    }
    let deliver = false;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.act && !deliver) throw new Error("Fixture prepare delivery unavailable");
      return cardToolResult(await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any)));
    });
    startCard("review", reviewRenderer); app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(root.querySelectorAll("button").some((item) => item.textContent === "Retry review")).toBe(true));
    let targetAccount = f.account, targetConnection = connection.connectionId;
    if (mode === "account") {
      targetAccount = `0x${"b".repeat(64)}`;
      f.notify({ ...f.transport.session("fixture-topic")!, accounts: [f.account, targetAccount] }, true);
      const manage = await f.run(() => f.cards.create("connect", { intent: "manage" }));
      expect((await f.act(manage, { action: "use_account", connectionId: connection.connectionId, account: targetAccount })).error).toBeUndefined();
      f.setSourceAccount(targetAccount);
    } else {
      f.notify(undefined);
      const session = { topic: "fixture-reconnected", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet" as const,
        expiresAt: new Date(f.now().getTime() + 1_800_000).toISOString(), walletName: "Reconnected fixture" };
      vi.spyOn(f.transport, "session").mockImplementation((topic) => topic === session.topic ? session : undefined);
      vi.spyOn(f.transport, "inspectAll").mockImplementation(() => [{ topic: session.topic, status: "present", session: session }]);
      f.connect.mockResolvedValueOnce({ uri: "wc:synthetic", expiresAt: session.expiresAt, approval: Promise.resolve(session) });
      const connect = await f.createConnection(); await f.act(connect, { action: "connect" });
      await vi.waitFor(() => expect(f.run(() => f.records.connections()).some((item) => item.topic === session.topic && item.connection.status === "connected")).toBe(true));
      targetConnection = f.run(() => f.records.connections()).find((item) => item.topic === session.topic)!.connection.connectionId;
    }
    show("hidden"); show("visible"); await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 2);
    const current = workflowViewSchema.parse((await f.read(card)).snapshot.data);
    expect(current.review!.reviewRevision).toBe(mode === "bound_connection" ? 1 : 0);
    expectReviewAccount(targetAccount);
    if (mode === "bound_connection") {
      expect(current.automaticAction).toBeUndefined(); expect(current.review!.state).toMatchObject({ refreshReason: "wallet_connection_changed" });
    } else {
      expect(current.automaticAction).toMatchObject({ account: targetAccount, connectionId: targetConnection });
      expect(root.textContent).toContain(mode === "connection" ? "Reconnected fixture" : "Fixture Wallet");
      expect(f.quote).not.toHaveBeenCalled();
    }
    const retry = root.querySelectorAll("button").find((item) => item.textContent === "Retry review");
    expect(retry?.disabled).toBe(false); deliver = true; retry!.click();
    await vi.waitFor(() => expect(f.quote).toHaveBeenCalledTimes(mode === "bound_connection" ? 2 : 1));
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs);
    const inputs = app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act).map(([call]) => call.arguments.input);
    expect(inputs).toHaveLength(2); expect(inputs[1]).toMatchObject({ action: "prepare_review", account: targetAccount, connectionId: targetConnection });
    expect(workflowViewSchema.parse((await f.read(card)).snapshot.data).review!.account).toBe(targetAccount);
    expectReviewAccount(targetAccount);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { f.close(); }
});

it.each(["clear", "select", "bound_change", "bound_clear"] as const)("keeps the displayed review account aligned with its binding: %s", async (mode) => {
  const f = await walletWorkflowFixture();
  const visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility); document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  try {
    const { connection } = await f.approve(), account = `0x${"b".repeat(64)}`;
    f.notify({ ...f.transport.session("fixture-topic")!, accounts: [f.account, account] }, true);
    const bound = mode === "bound_change" || mode === "bound_clear";
    if (mode === "select") await f.run(() => f.activity.clearActiveAccount(f.now()));
    const card = bound ? (await f.prepare(connection.connectionId)).card : await f.run(async () => {
      const { session } = await f.sessions.createReviewSession([f.plan], f.now());
      return f.cards.create("review", { reviewSessionId: session.id });
    });
    const deliver = bound;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.act && !deliver) throw new Error("Fixture preparation was not delivered");
      return cardToolResult(await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any)));
    });
    startCard("review", reviewRenderer);
    app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(root.querySelector(".review-material-facts")).toBeDefined());
    if (mode === "clear") await vi.waitFor(() => expect(root.querySelectorAll("button").some((item) => item.textContent === "Retry review")).toBe(true));
    expectReviewAccount(mode === "select" ? undefined : f.account);
    expect(root.querySelector(".review-material-status")!.textContent).toBe(bound ? "Current estimates" : "Amounts not checked yet");
    const oldCancel = root.querySelectorAll("button").find((item) => item.dataset.cardAction === "cancel")!;
    const secondsLeft = () => {
      const match = /Review expires in (\d+):(\d+)/.exec(root.querySelector(".review-time-remaining")!.textContent)!;
      return Number(match[1]) * 60 + Number(match[2]);
    };
    const initialRemaining = secondsLeft();
    f.advance(1000); await vi.advanceTimersByTimeAsync(1000);
    if (mode === "clear" || mode === "bound_clear") await f.run(() => f.activity.clearActiveAccount(f.now()));
    else {
      const manage = await f.run(() => f.cards.create("connect", { intent: "manage" }));
      expect((await f.act(manage, { action: "use_account", connectionId: connection.connectionId, account })).error).toBeUndefined();
      f.setSourceAccount(account);
    }
    for (const value of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", { value, writable: true }); visibility.dispatchEvent(new Event("visibilitychange"));
    }
    await vi.advanceTimersByTimeAsync(0);
    const current = workflowViewSchema.parse((await f.read(card)).snapshot.data);
    expect(current.activeAccount).toBe(mode === "clear" || mode === "bound_clear" ? undefined : account);
    expect(current.review!.account).toBe(bound ? f.account : undefined);
    expectReviewAccount(bound ? f.account : mode === "clear" ? undefined : account);
    expect(secondsLeft()).toBeLessThan(initialRemaining);
    if (!bound) {
      // A control retained by a previous target cannot act after that View is replaced.
      const calls = app.callServerTool.mock.calls.length;
      oldCancel.click(); await vi.advanceTimersByTimeAsync(0);
      expect(app.callServerTool).toHaveBeenCalledTimes(calls);
      expect(f.quote).not.toHaveBeenCalled();
    }
    if (mode === "select") {
      const commands = app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act);
      expect(commands).toHaveLength(1);
      expect(commands[0]![0].arguments.input).toMatchObject({ action: "prepare_review", account });
    } else {
      expect(current.automaticAction).toBeUndefined();
      expect(current.allowedActions).not.toContain("prepare_review");
      expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(mode === "clear" ? 1 : 0);
    }
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
  } finally { f.close(); }
});

it.each(["read_error_first", "action_first"] as const)("keeps explicit observation recovery across overlapping responses: %s", async (order) => {
  const f = await walletWorkflowFixture(); const visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility); document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  const show = (value: string) => { Object.defineProperty(document, "visibilityState", { value, writable: true }); visibility.dispatchEvent(new Event("visibilitychange")); };
  try {
    const { connection } = await f.approve(), { card, session } = await f.prepare(connection.connectionId);
    const actionReply = deferred<void>(), readReply = deferred<void>(), signature = deferred<{ transactionBytes: string; signature: string }>();
    f.sign.mockImplementation(() => signature.promise); let admitted = false, reads = 0;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.read && ++reads === 2) {
        await readReply.promise;
        throw new Error("Fixture concurrent read failed");
      }
      const response = await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any));
      if (name === CARD_TOOLS.act) { admitted = true; await actionReply.promise; }
      return cardToolResult(response);
    });
    startCard("review", reviewRenderer); app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    root.querySelectorAll("button").find((item) => item.dataset.cardAction === "request_signature")!.click();
    await vi.waitFor(() => expect(admitted).toBe(true)); show("hidden"); show("visible");
    if (order === "read_error_first") {
      readReply.resolve(); await vi.waitFor(() => expect(root.textContent).toContain("Fixture concurrent read failed")); actionReply.resolve();
    } else {
      actionReply.resolve(); await vi.waitFor(() => expect(root.textContent).toContain("Waiting for approval in your wallet")); readReply.resolve();
    }
    await vi.advanceTimersByTimeAsync(0);
    const recovery = () => root.querySelectorAll("button").find((item) => item.textContent === "Check status");
    await vi.waitFor(() => expect(recovery()?.disabled).toBe(false));
    expect(root.querySelectorAll("[data-card-action]").every((item) => item.disabled)).toBe(true);
    show("hidden"); show("visible"); await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 3);
    expect(reads).toBe(2); expect(recovery()).toBeDefined();
    const signed = await f.accountKey.signTransaction(Buffer.from(f.sign.mock.calls[0]![0].transactionBytesBase64, "base64"));
    signature.resolve({ transactionBytes: signed.bytes, signature: signed.signature });
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(session.id))?.requestStatus).toBe("completed"));
    recovery()!.click(); await vi.waitFor(() => expect(root.textContent).toContain("Transaction succeeded on Sui"));
    expect(reads).toBe(3); expect(recovery()).toBeUndefined();
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce(); expect(f.quote).toHaveBeenCalledOnce();
    await app.onteardown!();
  } finally { f.close(); }
});

it("does not carry Retry consent to a target changed during its state read", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve();
    const { session } = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    const card = await f.run(() => f.cards.create("review", { reviewSessionId: session.id }));
    let deliver = false, changeOnRead = false;
    const account = `0x${"b".repeat(64)}`;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.act && !deliver) throw new Error("Fixture initial delivery failed");
      if (name === CARD_TOOLS.read && changeOnRead) {
        changeOnRead = false;
        f.notify({ ...f.transport.session("fixture-topic")!, accounts: [f.account, account] }, true);
        const manage = await f.run(() => f.cards.create("connect", { intent: "manage" }));
        expect((await f.act(manage, { action: "use_account", connectionId: connection.connectionId, account })).error).toBeUndefined();
        f.setSourceAccount(account);
      }
      return cardToolResult(await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any)));
    });
    startCard("review", reviewRenderer); app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    const retry = () => root.querySelectorAll("button").find((item) => item.textContent === "Retry review");
    await vi.waitFor(() => expect(retry()?.disabled).toBe(false));
    expectReviewAccount(f.account);
    deliver = true; changeOnRead = true; retry()!.click();
    await vi.waitFor(() => expect(f.run(() => f.activity.getActiveAccount())).resolves.toMatchObject({ address: account }));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.quote).not.toHaveBeenCalled(); expect(retry()?.disabled).toBe(false);
    expectReviewAccount(account);
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
    retry()!.click(); await vi.waitFor(() => expect(f.quote).toHaveBeenCalledOnce());
    const commands = app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act);
    expect(commands[1]![0].arguments.input).toMatchObject({ action: "prepare_review", account, connectionId: connection.connectionId });
    expect(workflowViewSchema.parse((await f.read(card)).snapshot.data).review!.account).toBe(account);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { f.close(); }
});

it.each(['before_result','after_result'] as const)('keeps the admitted Chart result when a preselection read arrives %s',async(order)=>{
 const visibility=new EventTarget();document.addEventListener=visibility.addEventListener.bind(visibility);document.removeEventListener=visibility.removeEventListener.bind(visibility);
 Object.defineProperty(document,'visibilityState',{value:'visible',writable:true});
 const metadata={baseUrl:'https://example.invalid',endpoint:'get_pools' as const,url:'https://example.invalid/get_pools',fetchedAt:new Date().toISOString(),sourceStatement:DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT} as const;
 const chart=createDeepbookUsdcChartService({source:{fetchPools:async()=>({source:metadata,pools:[{pool_name:'SUI_USDC',pool_id:`0x${'1'.repeat(64)}`,base_asset_id:'0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',base_asset_symbol:'SUI',base_asset_decimals:9,quote_asset_id:DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE,quote_asset_symbol:'USDC',quote_asset_decimals:6}]}),fetchCandles:async()=>{sources++;await finishSource.promise;return{candles:[],source:{...metadata,endpoint:'ohclv' as const}};}}});
 const db=new SqliteActivityStore({databasePath:':memory:',validateAdapterLifecycle:validateSupportedAdapterLifecycle}),records=db.createCardRecordStore();
 const cards=createReadCardStore({records,ownerId:'fixture-owner',chart,readService:{summarizeAccountInventory:async()=>{throw Error('Unused');}},publicChainReceiptReader:async()=>{throw Error('Unused');}});
 let sources=0,reads=0;const finishSource=deferred<void>(),releaseRead=deferred<void>();let oldRead:CardSnapshot|undefined;
 try{
  const card=await cards.create('chart',{}),reference={cardId:card.snapshot.cardId,permission:card.permission};
  const app=host(async({name,arguments:args})=>{
   if(name===CARD_TOOLS.read){const response=await cards.read(cardReferenceSchema.parse(args));if(++reads===2){oldRead=response.snapshot;await releaseRead.promise;}return cardToolResult(response);}
   return cardToolResult(await cards.submit(args as any));
  });
  startCard('chart',chartRenderer);app.ontoolresult!({...cardToolResult(card),_meta:{[CARD_METADATA_KEY]:reference}});
  await vi.waitFor(()=>expect(root.querySelector('form')).toBeDefined());
  for(const value of ['hidden','visible']){Object.defineProperty(document,'visibilityState',{value,writable:true});visibility.dispatchEvent(new Event('visibilitychange'));}
  await vi.waitFor(()=>expect(oldRead?.state).toBe('ready'));
  expect(root.querySelectorAll('select')[0]!.disabled).toBe(false);
  root.querySelectorAll('select')[0]!.value='SUI_USDC';root.querySelectorAll('select')[0]!.dispatchEvent(new Event('change'));
  await vi.waitFor(()=>expect(sources).toBe(1));
  if(order==='before_result'){releaseRead.resolve();await vi.advanceTimersByTimeAsync(0);}
  finishSource.resolve();await vi.waitFor(()=>expect(root.textContent).toContain('No candles returned for this range'));
  const saved=await cards.read(reference);expect(saved.snapshot).toMatchObject({state:'closed',reason:'completed',input:{poolName:'SUI_USDC'}});
  if(order==='after_result'){releaseRead.resolve();await vi.advanceTimersByTimeAsync(0);}
  expect(root.textContent).not.toContain('Card unavailable');
  expect(root.textContent).not.toContain('The returned information does not match this card');
  expect(root.textContent).toContain('No candles returned for this range');
  expect(root.querySelectorAll('button').some(x=>x.textContent==='Check status')).toBe(false);
  expect(sources).toBe(1);
  await app.onteardown!();
 }finally{cards.stop();db.close();}
});

it.each(['connect','review'] as const)('ignores an older successful %s poll after an explicit stop',async(kind)=>{
 const f=await walletWorkflowFixture();const release=deferred<void>();let reads=0,oldRevision:number|undefined;
 try{
  let card:any;
  if(kind==='connect'){card=await f.createConnection();await f.act(card,{action:'connect'});await vi.waitFor(()=>expect(f.connect).toHaveBeenCalledOnce());card={...card,...await f.read(card)};}
  else{const {connection}=await f.approve();const ready=await f.prepare(connection.connectionId);card=ready.card;f.sign.mockImplementation(()=>new Promise(()=>{}));await f.act(card,{action:'request_signature',account:f.account,connectionId:connection.connectionId,reviewRevision:ready.session.reviewRevision});await vi.waitFor(()=>expect(f.sign).toHaveBeenCalledOnce());card={...card,...await f.read(card)};}
  const app=host(async({name,arguments:args})=>{
   const response=await f.run(()=>name===CARD_TOOLS.read?f.cards.read(cardReferenceSchema.parse(args)):f.cards.act(args as any));
   if(name===CARD_TOOLS.read&&++reads===2){oldRevision=response.snapshot.revision;await release.promise;}
   return cardToolResult(response);
  });
  startCard(kind,kind==='connect'?connectRenderer:reviewRenderer);app.ontoolresult!({...cardToolResult(card),_meta:{[CARD_METADATA_KEY]:{cardId:card.snapshot.cardId,permission:card.permission}}});
  await vi.waitFor(()=>expect(reads).toBe(1));await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs);
  await vi.waitFor(()=>expect(oldRevision).toBeDefined());
  const stop=root.querySelectorAll('button').find(x=>x.dataset.cardAction===(kind==='connect'?'stop_connection':'stop_waiting'))!;
  expect(stop?.disabled).toBe(false);stop.click();
  await vi.waitFor(()=>expect(root.textContent).toContain(kind==='connect'?'Connection request stopped':'Approval request stopped'));
  release.resolve();await vi.advanceTimersByTimeAsync(0);expect(root.textContent).not.toContain('Saved card state is older');
  const count=reads;await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs*4);expect(reads).toBe(count);
  const v=workflowViewSchema.parse((await f.read(card)).snapshot.data);expect(v.observe).toBe(false);
  expect(f.submit).not.toHaveBeenCalled();await app.onteardown!();
 }finally{f.close();}
});

it.each([false,true])('keeps request observation after an older successful read (coalesced poll: %s)',async(coalesced)=>{
 const f=await walletWorkflowFixture();const visibility=new EventTarget();document.addEventListener=visibility.addEventListener.bind(visibility);document.removeEventListener=visibility.removeEventListener.bind(visibility);Object.defineProperty(document,'visibilityState',{value:'visible',writable:true});
 const release=deferred<void>(),signature=deferred<{transactionBytes:string;signature:string}>();let reads=0,oldRevision:number|undefined;
 try{
  const {connection}=await f.approve(),{card,session}=await f.prepare(connection.connectionId);f.sign.mockImplementation(()=>signature.promise);
  const app=host(async({name,arguments:args})=>{
   const response=await f.run(()=>name===CARD_TOOLS.read?f.cards.read(cardReferenceSchema.parse(args)):f.cards.act(args as any));
   if(name===CARD_TOOLS.read&&++reads===2){oldRevision=response.snapshot.revision;await release.promise;}return cardToolResult(response);
  });
  startCard('review',reviewRenderer);app.ontoolresult!({...cardToolResult(card),_meta:{[CARD_METADATA_KEY]:{cardId:card.snapshot.cardId,permission:card.permission}}});
  await vi.waitFor(()=>expect(root.textContent).toContain('Ready for your review'));
  for(const value of ['hidden','visible']){Object.defineProperty(document,'visibilityState',{value,writable:true});visibility.dispatchEvent(new Event('visibilitychange'));}
  await vi.waitFor(()=>expect(oldRevision).toBeDefined());
  const request=root.querySelectorAll('button').find(x=>x.dataset.cardAction==='request_signature')!;expect(request.disabled).toBe(false);request.click();
  await vi.waitFor(()=>expect(root.textContent).toContain('Waiting for approval in your wallet'));
  if(coalesced)await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs*2);
  release.resolve();await vi.advanceTimersByTimeAsync(0);expect(root.textContent).not.toContain('Saved card state is older');
  const signed=await f.accountKey.signTransaction(Buffer.from(f.sign.mock.calls[0]![0].transactionBytesBase64,'base64'));signature.resolve({transactionBytes:signed.bytes,signature:signed.signature});
  await vi.waitFor(()=>expect(f.run(()=>f.records.currentRequest(session.id))?.requestStatus).toBe('completed'));
  await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs*2);expect(reads).toBeGreaterThan(2);expect(root.textContent).toContain('Transaction succeeded');
  expect(f.sign).toHaveBeenCalledOnce();expect(f.submit).toHaveBeenCalledOnce();await app.onteardown!();
 }finally{f.close();}
});


it.each(["throw", "typed", "admitted", "read_failed"] as const)("preserves Cancel intent after %s delivery failure", async (failure) => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card, session } = await f.prepare(connection.connectionId);
    let deliver = false, stopFailed = false, readFailed = false;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.read && failure === "read_failed" && stopFailed && !readFailed) {
        readFailed = true; throw new Error("Fixture stop confirmation unavailable");
      }
      if (name === CARD_TOOLS.act && (args.input as { action: string }).action === "cancel" && !deliver) {
        stopFailed = true;
        if (failure === "admitted") expect((await f.run(() => f.cards.act(args as any))).error).toBeUndefined();
        if (failure === "typed") return cardToolResult({ ...await f.read(card), error: { code: "card_conflict", message: "Fixture stop not admitted" } });
        throw new Error("Fixture stop not admitted");
      }
      return cardToolResult(await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any)));
    });
    startCard("review", reviewRenderer);
    app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    const details = root.querySelectorAll("details").find((node) => node.querySelector("summary")?.textContent === "Details")!;
    details.open = true; details.dispatchEvent(new Event("toggle"));
    const stop = root.querySelectorAll("button").find((node) => node.textContent === "Cancel")!;
    expect(stop.disabled).toBe(false); stop.click();
    await vi.advanceTimersByTimeAsync(0);
    if (failure === "read_failed") {
      await vi.waitFor(() => expect(root.textContent).toContain("Fixture stop confirmation unavailable"));
      expect(root.textContent).toContain("Fixture stop not admitted");
      root.querySelectorAll("button").find((node) => node.textContent === "Check status")!.click();
      await vi.advanceTimersByTimeAsync(0);
    }
    if (failure === "admitted") {
      await vi.waitFor(() => expect(root.textContent).toContain("This card no longer accepts actions"));
      expect(root.textContent).not.toContain("Fixture stop not admitted");
    } else {
      await vi.waitFor(() => expect(root.textContent).toContain("Fixture stop not admitted"));
      expect(root.textContent).toContain("Automatic review updates are paused");
    }
    const elapsed = Date.parse(session.reviewState!.humanReadableReview!.freshness.expiresAt) - f.now().getTime();
    f.advance(elapsed); await vi.advanceTimersByTimeAsync(elapsed + card.snapshot.pollAfterMs);
    expect(f.quote).toHaveBeenCalledOnce();
    const continuing = () => root.querySelectorAll("button").find((node) => node.textContent === "Continue review");
    if (failure === "admitted") expect(continuing()).toBeUndefined();
    else {
      expect(root.textContent).toContain("Fixture stop not admitted");
      expect(continuing()?.disabled).toBe(false); deliver = true;
      if (failure === "typed") {
        const reopened = root.querySelectorAll("details").find((node) => node.querySelector("summary")?.textContent === "Details")!;
        reopened.open = true; reopened.dispatchEvent(new Event("toggle"));
        root.querySelectorAll("button").find((node) => node.textContent === "Cancel")!.click();
        await vi.waitFor(async () => expect((await f.read(card)).snapshot.reason).toBe("cancelled"));
        expect(f.quote).toHaveBeenCalledOnce();
      } else {
        continuing()!.click(); await vi.waitFor(() => expect(f.quote).toHaveBeenCalledTimes(2));
        await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs);
        await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
        expect(root.querySelectorAll("button").filter((node) => node.dataset.cardAction === "request_signature")).toHaveLength(1);
        expect(root.textContent).not.toContain("Fixture stop not admitted");
      }
    }
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { f.close(); }
});

it("does not restart pairing when failed disconnection is followed by session disappearance", async () => {
  const f = await walletWorkflowFixture();
  const visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility); document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  try {
    let card = await f.createConnection();
    await f.approve(); card = await f.read(card);
    expect(workflowViewSchema.parse(card.snapshot.data).automaticAction).toBeUndefined();
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.act && (args.input as { action: string }).action === "disconnect") {
        f.notify(undefined); throw new Error("Fixture disconnect delivery lost");
      }
      return cardToolResult(await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any)));
    });
    startCard("connect", connectRenderer);
    app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    const button = (text: string) => root.querySelectorAll("button").find((node) => node.textContent === text);
    await vi.waitFor(() => expect(button("Disconnect")?.disabled).toBe(false)); button("Disconnect")!.click();
    expect(button("Confirm disconnect")?.disabled).toBe(false); button("Confirm disconnect")!.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Ask in chat to connect your wallet."));
    expect(workflowViewSchema.parse((await f.read(card)).snapshot.data).automaticAction).toEqual({ action: "connect", walletRunId: f.runtime.runId });
    expect(root.textContent).toContain("Fixture disconnect delivery lost");
    for (const value of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", { value, writable: true }); visibility.dispatchEvent(new Event("visibilitychange"));
    }
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 3);
    expect(f.connect).toHaveBeenCalledOnce();
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act).map(([call]) => call.arguments.input)).toHaveLength(1);
    expect(root.textContent).toContain("Fixture disconnect delivery lost");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { f.close(); }
});

it.each(["older", "failed"] as const)("does not retry a command after its confirming read is %s", async (mode) => {
  const f = await walletWorkflowFixture();
  const visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility); document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  try {
    await f.approve();
    const { session } = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    const card = await f.run(() => f.cards.create("review", { reviewSessionId: session.id }));
    const delayed = deferred<void>(); let recovering = false, retryReads = 0;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.act) throw new Error("Fixture initial preparation refused");
      if (recovering) {
        retryReads++; await delayed.promise;
        if (mode === "failed") throw new Error("Fixture retry confirmation unavailable");
        return cardToolResult(card);
      }
      return cardToolResult(await f.run(() => f.cards.read(cardReferenceSchema.parse(args))));
    });
    startCard("review", reviewRenderer);
    app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    const retry = () => root.querySelectorAll("button").find((node) => node.textContent === "Retry review");
    await vi.waitFor(() => expect(retry()?.disabled).toBe(false));
    f.notify({ ...f.transport.session("fixture-topic")!, accounts: [f.account, `0x${"b".repeat(64)}`] });
    expect((await f.read(card)).snapshot.revision).toBeGreaterThan(card.snapshot.revision);
    for (const value of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", { value, writable: true }); visibility.dispatchEvent(new Event("visibilitychange"));
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(retry()?.disabled).toBe(false); recovering = true; retry()!.click();
    await vi.waitFor(() => expect(retryReads).toBe(1));
    expect(retry()?.disabled).toBe(true); retry()!.click(); expect(retryReads).toBe(1);
    delayed.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
    expect(f.quote).not.toHaveBeenCalled();
    if (mode === "older") {
      expect(root.textContent).toContain("The card state changed"); expect(retry()?.disabled).toBe(false);
      expect(root.textContent).not.toContain("Saved card state is older");
    } else expect(root.querySelectorAll("button").find((node) => node.textContent === "Check status")?.disabled).toBe(false);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { f.close(); }
});

it("keeps the current expiry locked after its wake-up joins an older read", async () => {
  // Scheduler-only fixture: the real action/SQLite admission path is covered
  // above. Remaining time belongs to the current backend projection.
  const visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility); document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  const delayed = deferred<CallToolResult>();
  const old = timedReview({ allowedActions: ["prepare_review"], nextStateReadAfterMs: 500 });
  const current = { ...old, revision: 1, data: { ...old.data as object, nextStateReadAfterMs: 300 } };
  let reads = 0;
  const app = host(async ({ name }) => {
    if (name === CARD_TOOLS.act) return result(current);
    if (++reads === 2) return delayed.promise;
    return result(reads === 1 ? old : { ...current, revision: 2, data: { ...current.data as object, nextStateReadAfterMs: 0, allowedActions: [] } });
  });
  const controls: CardRenderer = { ...renderer, controls(_snapshot, act) {
    const button = document.createElement("button"); button.dataset.cardAction = "prepare_review"; button.textContent = "Prepare";
    button.addEventListener("click", () => act({ action: "prepare_review", connectionId: "fixture", account: `0x${"a".repeat(64)}`, reviewRevision: 0 }));
    return button;
  } };
  startCard("review", controls); app.ontoolresult!(result(old, true));
  await vi.advanceTimersByTimeAsync(0);
  for (const value of ["hidden", "visible"]) {
    Object.defineProperty(document, "visibilityState", { value, writable: true }); visibility.dispatchEvent(new Event("visibilitychange"));
  }
  await vi.waitFor(() => expect(reads).toBe(2));
  root.querySelectorAll("button").find((node) => node.textContent === "Prepare")!.click();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(300);
  expect(root.querySelectorAll("[data-card-action]").every((node) => node.disabled)).toBe(true);
  delayed.resolve(result(old)); await vi.advanceTimersByTimeAsync(0);
  expect(root.textContent).not.toContain("Saved card state is older");
  expect(root.querySelectorAll("[data-card-action]").every((node) => node.disabled)).toBe(true);
  // The expired authority requires one read started after that requirement;
  // joining the older read did not perform it. Once confirmed, do not loop.
  expect(reads).toBe(3); await vi.advanceTimersByTimeAsync(current.pollAfterMs);
  expect(reads).toBe(3);
  expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
  await app.onteardown!();
});

const recoveryButton = (label:string) => root.querySelectorAll("button").find((b)=>b.textContent===label);
it.each(["transaction", "connection", "card_expiry"] as const)("preserves terminal facts after a failed stop of %s",async(kind)=>{
 const visibility=new EventTarget();document.addEventListener=visibility.addEventListener.bind(visibility);document.removeEventListener=visibility.removeEventListener.bind(visibility);Object.defineProperty(document,'visibilityState',{value:'visible',writable:true});
 const f=await walletWorkflowFixture();let failRead=false;const signature=deferred<{transactionBytes:string;signature:string}>();
 try{
  let card:any,session:any;
  if(kind==='connection'){
   card=await f.createConnection();await f.act(card,{action:'connect'});await vi.waitFor(()=>expect(f.connect).toHaveBeenCalledOnce());card=await f.read(card);
  }else{
   const {connection}=await f.approve();const prepared=await f.prepare(connection.connectionId);card=prepared.card;session=prepared.session;
   if(kind==='transaction'){
    f.sign.mockImplementation(()=>signature.promise);await f.act(card,{action:'request_signature',connectionId:connection.connectionId,account:f.account,reviewRevision:session.reviewRevision});
    await vi.waitFor(()=>expect(f.sign).toHaveBeenCalledOnce());card=await f.read(card);
   }
  }
  const action=kind==='transaction'?'stop_waiting':kind==='connection'?'stop_connection':'cancel';
  const app=host(async({name,arguments:args})=>{
   if(name===CARD_TOOLS.read&&failRead)throw new Error('Fixture terminal state read unavailable');
   if(name===CARD_TOOLS.act && (args.input as any).action===action)throw new Error('Fixture stop delivery failed');
   return cardToolResult(await f.run(()=>name===CARD_TOOLS.read?f.cards.read(cardReferenceSchema.parse(args)):f.cards.act(args as any)));
  });
  startCard(kind==='connection'?'connect':'review',kind==='connection'?connectRenderer:reviewRenderer);
  app.ontoolresult!({...cardToolResult(card),_meta:{[CARD_METADATA_KEY]:{cardId:card.snapshot.cardId,permission:card.permission}}});
  if(kind==='card_expiry'){
   await vi.waitFor(()=>expect(root.textContent).toContain('Ready for your review'));
   const details=root.querySelectorAll('details').find(n=>n.querySelector('summary')?.textContent==='Details')!;details.open=true;details.dispatchEvent(new Event('toggle'));
  }
  await vi.waitFor(()=>expect(recoveryButton(kind==='card_expiry'?'Cancel':kind==='connection'?'Stop connecting':'Stop approval request')?.disabled).toBe(false));
  recoveryButton(kind==='card_expiry'?'Cancel':kind==='connection'?'Stop connecting':'Stop approval request')!.click();
  await vi.waitFor(()=>expect(root.textContent).toContain('Fixture stop delivery failed'));await vi.advanceTimersByTimeAsync(0);
  if(kind==='transaction'){
   const signed=await f.accountKey.signTransaction(Buffer.from(f.sign.mock.calls[0]![0].transactionBytesBase64,'base64'));signature.resolve({transactionBytes:signed.bytes,signature:signed.signature});
   await vi.waitFor(()=>expect(f.run(()=>f.records.currentRequest(session.id))?.requestStatus).toBe('completed'));
  }else if(kind==='connection'){
   f.approval.resolve({topic:'fixture-topic',accounts:[f.account],methods:['sui_signTransaction'],chain:'sui:mainnet',expiresAt:new Date(f.now().getTime()+1800000).toISOString(),walletName:'Fixture Wallet'});
   await vi.waitFor(()=>expect(f.run(()=>f.records.connections()[0]!.connection.status)).toBe('connected'));
  }else{
   f.advance(card.snapshot.inputRemainingMs+1);
   await vi.advanceTimersByTimeAsync(card.snapshot.inputRemainingMs+1);
  }
  await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs*2);
  const actual=await f.read(card);expect(actual.snapshot.state).toBe('closed');
  expect(recoveryButton('Check status')).toBeUndefined();
  expect(root.querySelector('.ui-error')?.textContent).not.toContain('Fixture stop delivery failed');
  expect(root.textContent).toContain(kind === 'transaction' ? 'Message from an earlier request to stop wallet approval:' : kind === 'connection' ? 'Message from an earlier request to stop connecting:' : 'Message from an earlier cancellation request:');
  const calls=app.callServerTool.mock.calls.length;await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs*3);expect(app.callServerTool.mock.calls.length).toBe(calls);
  if(kind==='transaction'){
   failRead=true;
   for(const value of ['hidden','visible']){Object.defineProperty(document,'visibilityState',{value,writable:true});visibility.dispatchEvent(new Event('visibilitychange'));}
   await vi.waitFor(()=>expect(root.querySelector('.ui-error')?.textContent).toContain('Fixture terminal state read unavailable'));
   expect(root.textContent).toContain('Transaction succeeded');expect(root.textContent).toContain('Message from an earlier request to stop wallet approval:');
   expect(root.querySelector('.ui-error')?.textContent).not.toContain('Fixture stop delivery failed');
   expect(recoveryButton('Check status')?.disabled).toBe(false);failRead=false;recoveryButton('Check status')!.click();
   await vi.advanceTimersByTimeAsync(0);expect(root.querySelector('.ui-error')?.textContent).toBe('');expect(recoveryButton('Check status')).toBeUndefined();
   expect(f.sign).toHaveBeenCalledOnce();expect(f.submit).toHaveBeenCalledOnce();
  }
  await app.onteardown!();
 }finally{f.close();}
});

it('confirms a failed stop after its read joins an older response',async()=>{
 const f=await walletWorkflowFixture();const release=deferred<void>(),signature=deferred<{transactionBytes:string;signature:string}>();
 const visibility=new EventTarget();document.addEventListener=visibility.addEventListener.bind(visibility);document.removeEventListener=visibility.removeEventListener.bind(visibility);Object.defineProperty(document,'visibilityState',{value:'visible',writable:true});
 let reads=0,old:CardSnapshot|undefined,failed=false;
 try{
  const {connection}=await f.approve(),{card,session}=await f.prepare(connection.connectionId);f.sign.mockImplementation(()=>signature.promise);
  const app=host(async({name,arguments:args})=>{
   if(name===CARD_TOOLS.act&&(args.input as any).action==='stop_waiting'){failed=true;throw new Error('Fixture stop delivery failed');}
   const actual=await f.run(()=>name===CARD_TOOLS.read?f.cards.read(cardReferenceSchema.parse(args)):f.cards.act(args as any));
   if(name===CARD_TOOLS.read&&++reads===2){old=actual.snapshot;await release.promise;}return cardToolResult(actual);
  });
  startCard('review',reviewRenderer);app.ontoolresult!({...cardToolResult(card),_meta:{[CARD_METADATA_KEY]:{cardId:card.snapshot.cardId,permission:card.permission}}});
  await vi.waitFor(()=>expect(recoveryButton('Request wallet approval')?.disabled).toBe(false));
  for(const value of ['hidden','visible']){Object.defineProperty(document,'visibilityState',{value,writable:true});visibility.dispatchEvent(new Event('visibilitychange'));}
  await vi.waitFor(()=>expect(old).toBeDefined());
  expect(recoveryButton('Request wallet approval')?.disabled).toBe(false);recoveryButton('Request wallet approval')!.click();
  await vi.waitFor(()=>expect(recoveryButton('Stop approval request')?.disabled).toBe(false));recoveryButton('Stop approval request')!.click();await vi.waitFor(()=>expect(failed).toBe(true));
  release.resolve();await vi.advanceTimersByTimeAsync(0);
  await vi.waitFor(()=>expect(reads).toBeGreaterThan(2));
  expect(recoveryButton('Stop approval request')?.disabled).toBe(false);expect(recoveryButton('Check status')).toBeUndefined();
  const signed=await f.accountKey.signTransaction(Buffer.from(f.sign.mock.calls[0]![0].transactionBytesBase64,'base64'));signature.resolve({transactionBytes:signed.bytes,signature:signed.signature});
  await vi.waitFor(()=>expect(f.run(()=>f.records.currentRequest(session.id))?.requestStatus).toBe('completed'));
  const before=reads;await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs*5);
  expect(reads).toBeGreaterThan(before);expect(root.textContent).toContain('Transaction succeeded');
  expect(f.sign).toHaveBeenCalledOnce();expect(f.submit).toHaveBeenCalledOnce();
  expect(app.callServerTool.mock.calls.filter(([c])=>c.name===CARD_TOOLS.act).map(([c])=>(c.arguments.input as any).action)).toEqual(['request_signature','stop_waiting']);
  await app.onteardown!();
 }finally{f.close();}
});

it.each(['review','connect'] as const)('recovers a %s preview error from the current stored projection',async(kind)=>{
 const f=await walletWorkflowFixture();
 try{
  if(kind==='review')await f.approve();
  const session=kind==='review'?await f.run(()=>f.sessions.createReviewSession([f.plan],f.now())):undefined;
  const card=await f.run(()=>f.cards.create(kind,session?{reviewSessionId:session.session.id}:{intent:'connect'}));
  const invalid={...card,snapshot:{...card.snapshot,data:{...card.snapshot.data as object,automaticAction:{action:'request_signature'}}}};
  const app=host(async({name,arguments:args})=>cardToolResult(await f.run(()=>name===CARD_TOOLS.read?f.cards.read(cardReferenceSchema.parse(args)):f.cards.act(args as any))));
  startCard(kind,kind==='review'?reviewRenderer:connectRenderer);app.ontoolresult!({...cardToolResult(invalid),_meta:{[CARD_METADATA_KEY]:{cardId:card.snapshot.cardId,permission:card.permission}}});
  await vi.waitFor(()=>expect(recoveryButton('Check status')?.disabled).toBe(false));expect(app.callServerTool).not.toHaveBeenCalled();recoveryButton('Check status')!.click();
  await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs*5);
  expect(app.callServerTool.mock.calls.filter(([c])=>c.name===CARD_TOOLS.act)).toHaveLength(1);
  expect(root.textContent).not.toContain('This card could not start the next step');expect(recoveryButton('Check status')).toBeUndefined();
  expect(kind==='review'?f.quote:f.connect).toHaveBeenCalledOnce();expect(f.sign).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();
  await app.onteardown!();
 }finally{f.close();}
});

it('recognizes an admitted signature-wait stop after its reply is lost',async()=>{
 const f=await walletWorkflowFixture();
 try{
  const {connection}=await f.approve(),{card,session}=await f.prepare(connection.connectionId);
  f.sign.mockImplementation(()=>new Promise(()=>{}));await f.act(card,{action:'request_signature',connectionId:connection.connectionId,account:f.account,reviewRevision:session.reviewRevision});
  const running=await f.read(card);
  const app=host(async({name,arguments:args})=>{
   const response=await f.run(()=>name===CARD_TOOLS.read?f.cards.read(cardReferenceSchema.parse(args)):f.cards.act(args as any));
   if(name===CARD_TOOLS.act){expect(response.error).toBeUndefined();throw new Error('Fixture admitted stop reply lost');}return cardToolResult(response);
  });
  startCard('review',reviewRenderer);app.ontoolresult!({...cardToolResult(running),_meta:{[CARD_METADATA_KEY]:{cardId:card.snapshot.cardId,permission:card.permission}}});
  await vi.waitFor(()=>expect(recoveryButton('Stop approval request')?.disabled).toBe(false));recoveryButton('Stop approval request')!.click();
  await vi.waitFor(()=>expect(root.textContent).toContain('Approval request stopped'));await vi.advanceTimersByTimeAsync(0);
  const data=workflowViewSchema.parse((await f.read(card)).snapshot.data);
  expect(data.request?.requestStatus).toBe('stopped');expect(data.observationStopped).toBe(false);
  expect(root.textContent).not.toContain('Fixture admitted stop reply lost');expect(recoveryButton('Check status')).toBeUndefined();
  expect(f.submit).not.toHaveBeenCalled();
  await app.onteardown!();
 }finally{f.close();}
});

const commandOutcomeButton=(text:string)=>root.querySelectorAll('button').find(b=>b.textContent===text);
it.each(['connect','prepare_review','request_signature'] as const)('ends the retry of failed %s when its input expires',async(action)=>{
 const f=await walletWorkflowFixture();
 try{
  let card:any;
  if(action==='connect')card=await f.createConnection();
  else{
   const {connection}=await f.approve();
   if(action==='request_signature')card=(await f.prepare(connection.connectionId)).card;
   else{const {session}=await f.run(()=>f.sessions.createReviewSession([f.plan],f.now()));card=await f.run(()=>f.cards.create('review',{reviewSessionId:session.id}));}
  }
  const app=host(async({name,arguments:args})=>{
   if(name===CARD_TOOLS.act)throw new Error('Fixture command delivery failed');
   return cardToolResult(await f.run(()=>f.cards.read(cardReferenceSchema.parse(args))));
  });
  startCard(action==='connect'?'connect':'review',action==='connect'?connectRenderer:reviewRenderer);
  app.ontoolresult!({...cardToolResult(card),_meta:{[CARD_METADATA_KEY]:{cardId:card.snapshot.cardId,permission:card.permission}}});
  if(action==='request_signature'){await vi.waitFor(()=>expect(commandOutcomeButton('Request wallet approval')?.disabled).toBe(false));commandOutcomeButton('Request wallet approval')!.click();}
  await vi.waitFor(()=>expect(root.textContent).toContain('Fixture command delivery failed'));await vi.advanceTimersByTimeAsync(0);
  const elapsed=Date.parse(card.snapshot.expiresAt)-f.now().getTime()+1;f.advance(elapsed);await vi.advanceTimersByTimeAsync(elapsed);
  const ended=await f.read(card),data=workflowViewSchema.parse(ended.snapshot.data);
  expect(ended.snapshot).toMatchObject({state:'closed',reason:'expired'});expect(data.allowedActions).toEqual([]);
  expect(commandOutcomeButton('Check status')).toBeUndefined();
  expect(root.querySelector('.ui-error')?.textContent).not.toContain('Fixture command delivery failed');expect(root.textContent).toContain(action === 'connect' ? 'Message from an earlier connection request:' : action === 'prepare_review' ? 'Message from an earlier review update:' : 'Message from an earlier wallet approval request:');
  expect(f.sign).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();
  await app.onteardown!();
 }finally{f.close();}
});

it.each([false,true])('separates result-read authority expiry from admitted work (admitted: %s)',async(admitted)=>{
 const f=await walletWorkflowFixture();const gate=deferred<void>();
 try{
  const {connection}=await f.approve(),{card,session}=await f.prepare(connection.connectionId);
  const originalRead=f.chainRead.getMockImplementation()!;
  f.chainRead.mockRejectedValueOnce(new Error('Fixture initial chain read unavailable'));
  expect((await f.act(card,{action:'request_signature',connectionId:connection.connectionId,account:f.account,reviewRevision:session.reviewRevision})).error).toBeUndefined();
  await vi.waitFor(()=>expect(f.run(()=>f.records.currentRequest(session.id))?.requestStatus).toBe('outcome_unknown'));
  let current=await f.read(card);const attempt=workflowViewSchema.parse(current.snapshot.data).request!;
  expect(workflowViewSchema.parse(current.snapshot.data).allowedActions).toContain('read_result');
  // Start the View near the stored deadline. Two poll periods allow initial
  // confirmation and the read command before exercising the expiry transition.
  // No observer is mounted while the fixture clock crosses the earlier wait.
  const confirmationWindowMs = current.snapshot.pollAfterMs * 2;
  const beforeWindowMs = Date.parse(card.snapshot.expiresAt) - f.now().getTime() - confirmationWindowMs;
  expect(beforeWindowMs).toBeGreaterThan(0);
  f.advance(beforeWindowMs); await vi.advanceTimersByTimeAsync(beforeWindowMs);
  current = await f.read(card);
  const beforeExpiry = workflowViewSchema.parse(current.snapshot.data);
  expect(beforeExpiry.actionRemainingMs).toBe(confirmationWindowMs);
  expect(beforeExpiry.allowedActions).toContain('read_result');
  expect(beforeExpiry.request?.attemptId).toBe(attempt.attemptId);

  f.chainRead.mockImplementation(async()=>{await gate.promise;return originalRead();});
  const app=host(async({name,arguments:args})=>{
   if(name===CARD_TOOLS.act){expect((args.input as any).action).toBe('read_result');if(admitted)expect((await f.run(()=>f.cards.act(args as any))).error).toBeUndefined();throw new Error('Fixture result-read delivery failed');}
   return cardToolResult(await f.run(()=>f.cards.read(cardReferenceSchema.parse(args))));
  });
  startCard('review',reviewRenderer);app.ontoolresult!({...cardToolResult(current),_meta:{[CARD_METADATA_KEY]:{cardId:card.snapshot.cardId,permission:card.permission}}});
  await vi.waitFor(()=>expect(commandOutcomeButton('Check transaction result')?.disabled).toBe(false));commandOutcomeButton('Check transaction result')!.click();
  await vi.advanceTimersByTimeAsync(0);if(admitted)await vi.waitFor(()=>expect(f.chainRead).toHaveBeenCalledTimes(2));
  const elapsed=Date.parse(card.snapshot.expiresAt)-f.now().getTime()+1;f.advance(elapsed);await vi.advanceTimersByTimeAsync(elapsed);
  const expired=await f.read(card),data=workflowViewSchema.parse(expired.snapshot.data);expect(data.actionRemainingMs).toBe(0);expect(data.allowedActions).toEqual([]);
  expect(data.request?.requestStatus).toBe('outcome_unknown');expect(data.request?.attemptId).toBe(attempt.attemptId);
  if(admitted){
   expect(data.observe).toBe(true);gate.resolve();await vi.waitFor(()=>expect(f.run(()=>f.records.currentRequest(session.id))?.requestStatus).toBe('completed'));
   await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs*2);expect(root.textContent).toContain('Transaction succeeded on Sui');
   expect(commandOutcomeButton('Check status')).toBeUndefined();
  }else{
   expect(data.observe).toBe(false);expect(commandOutcomeButton('Check status')).toBeUndefined();
   expect(root.querySelector('.ui-error')?.textContent).not.toContain('Fixture result-read delivery failed');expect(f.chainRead).toHaveBeenCalledOnce();
   expect(root.textContent).toContain('ask to open its result in chat');
   const management=await f.run(()=>f.cards.create('review',{reviewSessionId:session.id,attemptId:attempt.attemptId,mode:'manage'}));
   expect(workflowViewSchema.parse(management.snapshot.data).allowedActions).toContain('read_result');
  }
  expect(f.sign).toHaveBeenCalledOnce();expect(f.submit).toHaveBeenCalledOnce();
  await app.onteardown!();
 }finally{f.close();}
});

it.each([false, true])("keeps a later confirmation separate from an equal-revision read (old read fails: %s)", async (failRead) => {
  const f = await walletWorkflowFixture(), gate = deferred<void>();
  try {
    let card = await f.createConnection(); await f.act(card, { action: "connect" });
    await vi.waitFor(() => expect(f.connect).toHaveBeenCalledOnce()); card = await f.read(card);
    let reads = 0, oldRevision: number | undefined;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.act) throw new Error("Fixture stop delivery unavailable");
      const response = await f.run(() => f.cards.read(cardReferenceSchema.parse(args)));
      if (++reads === 2) {
        oldRevision = response.snapshot.revision; await gate.promise;
        if (failRead) throw new Error("Fixture earlier read failed");
      }
      return cardToolResult(response);
    });
    startCard("connect", connectRenderer);
    app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(recoveryButton("Stop connecting")?.disabled).toBe(false));
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs); expect(reads).toBe(2);
    expect(recoveryButton("Stop connecting")?.disabled).toBe(false); recoveryButton("Stop connecting")!.click();
    await vi.waitFor(() => expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1));
    expect((await f.read(card)).snapshot.revision).toBe(oldRevision);
    gate.resolve(); await vi.advanceTimersByTimeAsync(0);
    if (failRead) {
      expect(reads).toBe(2); expect(recoveryButton("Check status")?.disabled).toBe(false);
      await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 2); expect(reads).toBe(2);
      recoveryButton("Check status")!.click(); await vi.advanceTimersByTimeAsync(0);
    }
    expect(reads).toBe(3); expect(recoveryButton("Stop connecting")?.disabled).toBe(false);
    expect(f.connect).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
    await app.onteardown!();
  } finally { f.close(); }
});

it("keeps a losing connection card explicit through the other connection's completion and removal", async () => {
  const f = await walletWorkflowFixture(), opening = deferred<Awaited<ReturnType<typeof f.transport.connect>>>();
  const visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility); document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  const revisit = async () => {
    for (const value of ["hidden", "visible"]) { Object.defineProperty(document, "visibilityState", { value, writable: true }); visibility.dispatchEvent(new Event("visibilitychange")); }
    await vi.advanceTimersByTimeAsync(0);
  };
  try {
    const originalConnect = f.connect.getMockImplementation()!; f.connect.mockImplementationOnce(() => opening.promise);
    const cards = [await f.createConnection(), await f.createConnection()];
    for (const card of cards) expect(workflowViewSchema.parse(card.snapshot.data).automaticAction).toEqual({ action: "connect", walletRunId: f.runtime.runId });
    const views = cards.map((card) => {
      root = new Element("main"); const node = root;
      const app = host(async ({ name, arguments: args }) => cardToolResult(await f.run(() => name === CARD_TOOLS.read
        ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any))));
      startCard("connect", connectRenderer);
      app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
      return { node, app, card };
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.run(() => f.records.connections())).toHaveLength(1);
    const winner = views.find((view) => f.run(() => f.cardRecords.get(view.card.snapshot.cardId))?.operationId)!;
    const loser = views.find((view) => view !== winner)!;
    expect(loser.node.textContent).toContain("Connection approval is pending in another card");
    expect(loser.node.querySelector("canvas")).toBeUndefined();
    expect(loser.node.querySelectorAll("button").some((node) => node.textContent === "Stop connecting")).toBe(false);
    const sent = () => loser.app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act);
    expect(sent()).toHaveLength(1);
    opening.resolve(await originalConnect());
    f.approval.resolve({ topic: "fixture-topic", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet",
      expiresAt: new Date(f.now().getTime() + 1_800_000).toISOString(), walletName: "Fixture Wallet" });
    await vi.waitFor(() => expect(f.run(() => f.records.connections()[0]!.connection.status)).toBe("connected"));
    await revisit();
    expect(loser.node.textContent).toContain("Wallet connected"); expect(loser.node.textContent).toContain("Message from an earlier connection request");
    expect(loser.node.querySelector(".ui-error")?.textContent).toBe("");
    f.notify(undefined); await revisit();
    expect(loser.node.textContent).toContain("No wallet connected"); expect(loser.node.textContent).toContain("Message from an earlier connection request");
    expect(loser.node.querySelector(".ui-error")?.textContent).toBe("");
    await vi.advanceTimersByTimeAsync(loser.card.snapshot.pollAfterMs * 3);
    expect(f.connect).toHaveBeenCalledOnce(); expect(sent()).toHaveLength(1);
    const retriedSession = { topic: "fixture-retried-topic", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet" as const,
      expiresAt: new Date(f.now().getTime() + 1_800_000).toISOString(), walletName: "Retried fixture wallet" };
    f.connect.mockResolvedValueOnce({ uri: "wc:retried-fixture", expiresAt: retriedSession.expiresAt, approval: Promise.resolve(retriedSession) });
    vi.spyOn(f.transport, "session").mockImplementation((topic) => topic === retriedSession.topic ? retriedSession : undefined);
      vi.spyOn(f.transport, "inspectAll").mockImplementation(() => [{ topic: retriedSession.topic, status: "present", session: retriedSession }]);
    const retry = loser.node.querySelectorAll("button").find((node) => node.textContent === "Retry connection")!;
    expect(retry.disabled).toBe(false); retry.click();
    await vi.waitFor(() => expect(f.connect).toHaveBeenCalledTimes(2));
    expect(sent()).toHaveLength(2);
    await vi.waitFor(async () => expect((await f.read(loser.card)).snapshot).toMatchObject({ state: "closed", data: { connection: { status: "connected" } } }));
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await winner.app.onteardown!(); await loser.app.onteardown!();
  } finally { f.close(); }
});

it.each(["disconnect", "use_account_connection", "use_account_removed"] as const)("ends an unadmitted %s failure using its exact external target", async (mode) => {
  const f = await walletWorkflowFixture(), visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility); document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  try {
    const { connection } = await f.approve(), originalSession = f.transport.session("fixture-topic")!;
    if (mode !== "disconnect") await f.run(() => f.activity.clearActiveAccount(f.now()));
    const card = await f.createConnection(); let deliver = false, readFails = false;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.read && readFails) throw new Error("Fixture current connection read failed");
      if (name === CARD_TOOLS.act && !deliver) {
        expect((args.input as { action: string }).action).toBe(mode === "disconnect" ? "disconnect" : "use_account");
        if (mode === "use_account_removed") f.notify({ ...originalSession, accounts: [`0x${"b".repeat(64)}`] }, true);
        else f.notify(undefined);
        throw new Error("Fixture target command was not delivered");
      }
      return cardToolResult(await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any)));
    });
    startCard("connect", connectRenderer);
    app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    const button = (text: string) => root.querySelectorAll("button").find((node) => node.textContent === text);
    const chooseAccount = () => {
      expect(button("Use address")?.disabled).toBe(false);
      expect(root.querySelectorAll("select")).toHaveLength(0); button("Use address")!.click();
    };
    if (mode === "disconnect") {
      await vi.waitFor(() => expect(button("Disconnect")?.disabled).toBe(false)); button("Disconnect")!.click();
      expect(button("Confirm disconnect")?.disabled).toBe(false); button("Confirm disconnect")!.click();
    } else { await vi.waitFor(() => expect(button("Use address")?.disabled).toBe(false)); chooseAccount(); }
    await vi.waitFor(() => expect(root.textContent).toContain(mode === "disconnect" ? "Message from an earlier wallet disconnect request" : "Message from an earlier account selection"));
    const current = workflowViewSchema.parse((await f.read(card)).snapshot.data), target = current.connections.find((item) => item.connectionId === connection.connectionId)!;
    expect(current.connection).toBeUndefined(); expect(target.status).toBe(mode === "use_account_removed" ? "connected" : "disconnected");
    if (mode !== "disconnect") expect(current.activeAccount).toBeUndefined();
    expect(root.querySelector(".ui-error")?.textContent).toBe("");
    expect(root.textContent).toContain("Fixture target command was not delivered"); expect(button("Check status")).toBeUndefined();
    if (mode === "use_account_removed") {
      // Reappearance is a new possible selection, not a revival of this attempt.
      f.notify(originalSession, true);
      for (const value of ["hidden", "visible"]) { Object.defineProperty(document, "visibilityState", { value, writable: true }); visibility.dispatchEvent(new Event("visibilitychange")); }
      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain("Message from an earlier account selection"); expect(root.querySelector(".ui-error")?.textContent).toBe("");
      expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
      deliver = true; chooseAccount();
      await vi.waitFor(async () => expect(workflowViewSchema.parse((await f.read(card)).snapshot.data).activeAccount).toBe(f.account));
      expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(2);
    } else {
      // A genuine later read error must remain recoverable beside the old attempt.
      readFails = true;
      for (const value of ["hidden", "visible"]) { Object.defineProperty(document, "visibilityState", { value, writable: true }); visibility.dispatchEvent(new Event("visibilitychange")); }
      await vi.waitFor(() => expect(root.querySelector(".ui-error")?.textContent).toContain("Fixture current connection read failed"));
      expect(root.querySelector(".ui-error")?.textContent).not.toContain("Fixture target command was not delivered");
      expect(root.textContent).toContain(mode === "disconnect" ? "Message from an earlier wallet disconnect request:" : "Message from an earlier account selection:"); readFails = false; button("Check status")!.click(); await vi.advanceTimersByTimeAsync(0);
      expect(root.querySelector(".ui-error")?.textContent).toBe(""); expect(button("Check status")).toBeUndefined();
      expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
    }
    expect(f.connect).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
  } finally { f.close(); }
});

it.each(["other_connection", "wallet_unavailable"] as const)("does not end a failed selection from %s facts", async (mode) => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(); await f.run(() => f.activity.clearActiveAccount(f.now()));
    const old = f.run(() => f.records.restoreConnection({ topic: "historical-other", accounts: [`0x${"b".repeat(64)}`], methods: ["sui_signTransaction"],
      chain: "sui:mainnet", expiresAt: new Date(f.now().getTime() + 60_000).toISOString() }, f.now()));
    f.run(() => f.records.updateConnection(old.connection.connectionId, { status: "disconnected" }, f.now()));
    const card = await f.createConnection();
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.act) {
        if (mode === "wallet_unavailable") { vi.spyOn(f.transport, "inspectAll").mockImplementation(() => { throw new Error("Synthetic wallet status unavailable"); }); f.observe(); }
        throw new Error("Fixture selection still unconfirmed");
      }
      return cardToolResult(await f.run(() => f.cards.read(cardReferenceSchema.parse(args))));
    });
    startCard("connect", connectRenderer);
    app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(root.querySelectorAll("button").find((node) => node.textContent === "Use address")?.disabled).toBe(false));
    expect(root.querySelectorAll("select")).toHaveLength(0);
    root.querySelectorAll("button").find((node) => node.textContent === "Use address")!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector(".ui-error")?.textContent).toContain("Fixture selection still unconfirmed");
    expect(root.textContent).not.toContain("Message from an earlier account selection");
    const current = workflowViewSchema.parse((await f.read(card)).snapshot.data);
    expect(current.connections.find((item) => item.connectionId === connection.connectionId)?.status).toBe("connected");
    expect(current.walletAvailability.status).toBe(mode === "wallet_unavailable" ? "unavailable" : "available");
    expect(f.connect).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { f.close(); }
});

it("describes stale public review facts without asking for an unavailable update", async () => {
  const f = await walletWorkflowFixture(), mcp = await savedWorkflowMcp(f);
  try {
    const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
    const app = host(mcp.call); app.readServerResource.mockImplementation(mcp.readResource);
    startCard("review", reviewRenderer); app.ontoolresult!(cardToolResult(card));
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    expect(root.querySelectorAll("[data-card-action]")).toHaveLength(0);
    expect(root.textContent).not.toContain("Ready to request approval");
    await app.onteardown!();
    const review = workflowViewSchema.parse(card.snapshot.data).review!.state!;
    f.advance(Date.parse(review.humanReadableReview!.freshness.expiresAt) - f.now().getTime() + 1);
    const stale = await f.read(card);
    expect(workflowViewSchema.parse(stale.snapshot.data).review!.state!.refreshReason).toBe("review_evidence_stale");
    root.replaceChildren();
    const replay = host(mcp.call); replay.readServerResource.mockImplementation(mcp.readResource);
    startCard("review", reviewRenderer); replay.ontoolresult!(cardToolResult(stale));
    await vi.waitFor(() => expect(root.textContent).toContain("These review details are no longer current."));
    expect(root.textContent).toContain("Ask in chat for a new transaction review.");
    expect(root.textContent).not.toContain("Update the review before");
    expect(root.querySelectorAll("[data-card-action]")).toHaveLength(0);
    recoveryButton("Check status")!.click();
    await vi.waitFor(() => expect(replay.readServerResource).toHaveBeenCalledTimes(2));
    expect(replay.callServerTool).not.toHaveBeenCalled();
    expect(f.quote).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await replay.onteardown!();
  } finally { await mcp.close(); f.close(); }
});

it("separates an actual rejected command from its later history and the expired review's next step", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
    let first = true, rejection: string | undefined;
    const app = host(async ({ name, arguments: args }) => {
      // A real connection update races the click. CardStore owns the refusal.
      if (name === CARD_TOOLS.act && first) { first = false; f.notify(undefined); }
      const response = await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any));
      if (name === CARD_TOOLS.act) rejection = response.error?.code;
      return cardToolResult(response);
    });
    startCard("review", reviewRenderer);
    app.ontoolresult!({ ...cardToolResult(card), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(recoveryButton("Cancel")?.disabled).toBe(false)); recoveryButton("Cancel")!.click();
    await vi.waitFor(() => expect(rejection).toBe("card_conflict"));
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelectorAll(".ui-error, .ui-note").some((node) => node.textContent.includes('Message for this cancellation request: “This request does not match the card\'s current state.”'))).toBe(true);
    f.advance(card.snapshot.inputRemainingMs + 1); await vi.advanceTimersByTimeAsync(card.snapshot.inputRemainingMs + 1);
    await vi.waitFor(() => expect(root.textContent).toContain('Message from an earlier cancellation request: “This request does not match the card\'s current state.”'));
    expect(root.querySelector(".ui-error")?.textContent ?? "").not.toContain("cancellation request");
    expect(root.textContent).toContain("This card no longer accepts actions.");
    expect(visibleGuidance()).toContain("Ask in chat for a new transaction review.");
    expect(root.textContent.split("Ask in chat for a new transaction review.")).toHaveLength(2);
    expect(root.textContent).not.toContain("Read the current state before acting");
    expect(root.textContent).toContain("Earlier review message: “The selected wallet connection changed.”");
    expect(root.textContent).not.toContain("Message from the previous review update");
    expect(root.querySelectorAll("[data-card-action]")).toHaveLength(0);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
  } finally { f.close(); }
});

it.each([{ rebate: "20", expected: "0.00000013 SUI" }, { rebate: "200", expected: "-0.00000005 SUI" }])(
  "distinguishes estimated and observed net fees from the gas limit with rebate $rebate", async ({ rebate, expected }) => {
    const f = await walletWorkflowFixture();
    try {
      const simulate = f.simulate.getMockImplementation()!;
      f.simulate.mockImplementation(async (input) => {
        const result = await simulate(input);
        if (result.$kind !== "Transaction") throw new Error("Expected successful external simulation fixture");
        result.Transaction.effects.gasUsed.storageRebate = rebate;
        return result;
      });
      const { connection } = await f.approve(), { card } = await f.prepare(connection.connectionId);
      const view = reviewRenderer.result(card.snapshot, undefined, undefined);
      // External fixture inputs: 100 computation + 50 storage - 20/200 rebate;
      // 1 SUI = 10^9 MIST. Gas budget is independently fixed at 1,000 MIST.
      expect(factValues(view.node as unknown as Element, "Estimated network fee")).toEqual([`${expected} · Network fee limit (gas budget): 0.000001 SUI`]);
      const transaction = structuredClone(cardReceiptTransaction);
      transaction.effects.gasUsed.storageRebate = rebate;
      const receipt = await readPublicChainReceipt({ network: "mainnet", expectedChainIdentifier: "mainnet-chain", client: { core: {
        getChainIdentifier: async () => ({ chainIdentifier: "mainnet-chain" }),
        getTransaction: async () => ({ $kind: "Transaction" as const, Transaction: transaction })
      } } }, { digest: chainReceiptDigest, now: f.now() });
      expect(receipt.status).toBe("found"); if (receipt.status !== "found") throw new Error("Receipt fixture failed");
      const result = receiptRenderer.result(state("receipt", { state: "closed", reason: "completed", data: projectReadCardResult("receipt", { digest: chainReceiptDigest }, receipt).data }), undefined);
      expect(factValues(result.node as unknown as Element, "Network fee")).toEqual([expected]);
      expect(result.node.textContent).not.toContain("Estimated network fee");
      const details = chainReceiptDetails(receipt.receipt);
      expect(details.textContent).toContain("The network fee shown above includes the storage rebate");
      expect(factValues(details as unknown as Element, "Network fee limit (gas budget)")).toEqual(["0.001 SUI"]);
      expect(details.textContent).toContain("It is not an estimate of the amount charged.");
      expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); view.dispose?.(); if ("dispose" in result) result.dispose();
    } finally { f.close(); }
  });

it("quotes an earlier stored update message without treating its old instruction as a current action", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve(), { card, session } = await f.prepare(connection.connectionId);
    f.run(() => {
      const preparation = f.records.beginReviewPreparation(f.cardRecords.get(card.snapshot.cardId)!, session.reviewRevision,
        f.records.connection(connection.connectionId)!.connection, f.account);
      f.records.failPreparation(session.id, preparation, f.now());
    });
    const oldMessage = "Review update could not be completed. Update this review to try again.";
    // Explicit persisted-message fixture for a database created by an older
    // version. The production projection and renderer consume it unchanged.
    const database = new Database(`${f.directory}/activity.sqlite`);
    try { database.prepare("UPDATE live_review_sessions SET preparation_error=?,write_contract_version=?,revision=revision+1 WHERE id=?").run(oldMessage, LIVE_REVIEW_SESSION_WRITE_CONTRACT_VERSION, session.id); }
    finally { database.close(); }
    const current = await f.read(card);
    expect(workflowViewSchema.parse(current.snapshot.data).review!.error).toBe(`Earlier review message: “${oldMessage}”`);
    const app = host(async ({ name, arguments: args }) => cardToolResult(await f.run(() => name === CARD_TOOLS.read
      ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any))));
    startCard("review", reviewRenderer);
    app.ontoolresult!({ ...cardToolResult(current), _meta: { [CARD_METADATA_KEY]: { cardId: card.snapshot.cardId, permission: card.permission } } });
    await vi.waitFor(() => expect(recoveryButton("Retry review")?.disabled).toBe(false));
    expect(root.querySelector(".ui-error")?.textContent ?? "").toBe("");
    expect(root.querySelector(".review-action-feedback")?.textContent).toContain(`Earlier review message: “${oldMessage}”`);
    expect(f.run(() => f.sessions.readReviewSession(session.id))?.preparationError).toBe(oldMessage);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.quote).toHaveBeenCalledOnce();
    recoveryButton("Retry review")!.click();
    await vi.waitFor(() => expect(f.quote).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(f.run(() => f.sessions.readReviewSession(session.id))?.preparationError).toBeUndefined());
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
  } finally { f.close(); }
});

it.each([
  { input: "poolName=SUI_USDC&interval=1d&limit=7", reason: "source_timeout", expected: "The chart data source did not respond in time.", calls: 1 },
  { input: "poolName=SUI_USDC&startTimeMs=20&endTimeMs=10", reason: "invalid_timestamp_window", expected: "The start time must be before the end time.", calls: 0 }
])("explains the chart source's $reason without exposing its code as the primary message", async ({ input, reason, expected, calls }) => {
  const fetchPools = vi.fn(async () => { throw new DeepbookOfficialIndexerSourceError("source_timeout", "Fixture source timeout"); });
  const fetchCandles = vi.fn(async () => { throw new Error("No candle query should start"); });
  const chart = createDeepbookUsdcChartService({ source: { fetchPools, fetchCandles } });
  const data = await chart.getCandles(new URLSearchParams(input));
  expect(data).toMatchObject({ reason });
  const view = chartRenderer.result(state("chart", { state: "closed", reason: "completed", data }));
  const node = view.node as unknown as Element;
  expect(node.children[0]!.textContent).toBe(expected);
  expect(node.children[0]!.textContent).not.toContain(reason);
  expect(node.querySelector("details")!.textContent).toContain(`Reported reason: ${reason}`);
  expect(node.querySelector("details")!.open).toBe(false);
  expect(node.textContent).toContain("Ask in chat for a new chart");
  expect(fetchPools).toHaveBeenCalledTimes(calls); expect(fetchCandles).not.toHaveBeenCalled();
});

// These helpers bind real persisted card responses to their creating metadata;
// they do not drop typed errors or replace the lifecycle under test.
function cardCreation(response: Parameters<typeof cardToolResult>[0], permission: string): CallToolResult {
  const packet = cardToolResult(response);
  return { ...packet, _meta: { ...packet._meta, [CARD_METADATA_KEY]: { cardId: response.snapshot.cardId, permission } } };
}
function visibleGuidance(): string {
  const node = root.querySelector(".card-guidance");
  return node && !node.hidden ? node.textContent : "";
}
function visibleFrame() {
  const events = new EventTarget();
  document.addEventListener = events.addEventListener.bind(events);
  document.removeEventListener = events.removeEventListener.bind(events);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  return (value: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { value, writable: true });
    events.dispatchEvent(new Event("visibilitychange"));
  };
}

it("offers a new review only after its stored session ends, even when its later card is ready", async () => {
  const f = await walletWorkflowFixture(), mcp = await savedWorkflowMcp(f);
  try {
    const { session } = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    f.advance(10 * 60_000); // A deliberately later card must not extend this review.
    const { connection } = await f.approve();
    const created = await f.run(() => f.cards.create("review", { reviewSessionId: session.id }));
    expect(Date.parse(created.snapshot.expiresAt)).toBeGreaterThan(Date.parse(session.expiresAt));
    await f.act(created, { action: "prepare_review", connectionId: connection.connectionId, account: f.account, reviewRevision: 0 });
    await vi.waitFor(() => expect(f.run(() => f.sessions.readReviewSession(session.id))?.status).toBe("ready_for_wallet_review"));
    const card = await f.read(created), app = host(mcp.call);
    startCard("review", reviewRenderer); app.ontoolresult!(cardCreation(card, created.permission));
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    expect(visibleGuidance()).not.toContain("new transaction review");
    const left = Date.parse(session.expiresAt) - f.now().getTime() + 1;
    f.advance(left); await vi.advanceTimersByTimeAsync(left);
    await vi.waitFor(() => expect(visibleGuidance()).toBe("Ask in chat for a new transaction review."));
    expect(root.querySelector(".review-action-feedback")?.querySelector(".card-guidance")).toBe(root.querySelector(".card-guidance"));
    const stored = await f.read(created);
    expect(stored.snapshot.state).toBe("ready");
    expect(workflowViewSchema.parse(stored.snapshot.data)).toMatchObject({ actionRemainingMs: 0, review: { status: "expired" } });
    expect(root.querySelectorAll("[data-card-action]").every((node) => node.disabled)).toBe(true);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!(); expect(vi.getTimerCount()).toBe(0);
  } finally { await mcp.close(); f.close(); }
});

it.each(["ended", "unavailable"] as const)("uses confirmed connection facts for one next step: %s", async (mode) => {
  const f = await walletWorkflowFixture(), mcp = await savedWorkflowMcp(f);
  try {
    const card = await f.createConnection();
    if (mode === "unavailable") {
      vi.spyOn(f.transport, "inspectAll").mockImplementation(() => { throw new Error("Fixture SDK state failure"); }); f.observe();
      f.notify(undefined);
    }
    const app = host(async (request) => {
      if (request.name === CARD_TOOLS.act) throw new Error("Fixture undelivered connection");
      return mcp.call(request);
    });
    startCard("connect", connectRenderer); app.ontoolresult!(cardCreation(await f.read(card), card.permission));
    if (mode === "ended") {
      await vi.waitFor(() => expect(recoveryButton("Retry connection")).toBeDefined());
      f.advance(card.snapshot.inputRemainingMs + 1); await vi.advanceTimersByTimeAsync(card.snapshot.inputRemainingMs + 1);
      await vi.waitFor(() => expect(visibleGuidance()).toContain("Ask in chat to connect your wallet."));
      expect((await f.read(card)).snapshot.state).toBe("closed");
      expect(root.textContent.split("Ask in chat to connect your wallet.")).toHaveLength(2);
      expect(root.textContent).not.toContain("Ask in chat to check your wallet connection.");
      expect(recoveryButton("Retry connection")).toBeUndefined();
    } else {
      await vi.waitFor(() => expect(visibleGuidance()).toBe("To restart the connection service, fully quit all apps using Sui MCP, then reopen them. This does not confirm removal of a connection in your wallet app."));
      expect(workflowViewSchema.parse((await f.read(card)).snapshot.data)).toMatchObject({ walletAvailability: { status: "unavailable" }, connections: [], allowedActions: ["cancel"] });
      expect(root.textContent).toContain("Connection not confirmed");
      expect(root.textContent).not.toContain("Ask in chat to connect");
    }
    expect(f.connect).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
  } finally { await mcp.close(); f.close(); }
});

async function storedReadCardFixture() {
  const metadata = { baseUrl: "https://example.invalid", endpoint: "get_pools" as const, url: "https://example.invalid/get_pools",
    fetchedAt: new Date().toISOString(), sourceStatement: DEEPBOOK_OFFICIAL_INDEXER_SOURCE_STATEMENT } as const;
  const candles = vi.fn(async () => ({ candles: [], source: { ...metadata, endpoint: "ohclv" as const } }));
  const chart = createDeepbookUsdcChartService({ source: { fetchPools: async () => ({ source: metadata, pools: [{
    pool_name: "SUI_USDC", pool_id: `0x${"1".repeat(64)}`, base_asset_id: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
    base_asset_symbol: "SUI", base_asset_decimals: 9, quote_asset_id: DEEPBOOK_OFFICIAL_INDEXER_CANONICAL_USDC_COIN_TYPE,
    quote_asset_symbol: "USDC", quote_asset_decimals: 6
  }] }), fetchCandles: candles } });
  const receipt = await readPublicChainReceipt({ network: "mainnet", expectedChainIdentifier: "mainnet-chain", client: { core: {
    getChainIdentifier: async () => ({ chainIdentifier: "mainnet-chain" }),
    getTransaction: async () => ({ $kind: "Transaction" as const, Transaction: cardReceiptTransaction })
  } } }, { digest: chainReceiptDigest, now: new Date() });
  const receipts = vi.fn(async () => receipt);
  const accounts = vi.fn(async ({ account }: { account: string }) => ({ status: "ok" as const, account, name: null,
    balances: [], nfts: [], objectGroups: [], scannedObjects: 0, objectsTruncated: false, fetchedAt: new Date().toISOString() }));
  const db = new SqliteActivityStore({ databasePath: ":memory:", validateAdapterLifecycle: validateSupportedAdapterLifecycle });
  const cards = createReadCardStore({ records: db.createCardRecordStore(), ownerId: "display-fixture", chart,
    readService: { summarizeAccountInventory: accounts }, publicChainReceiptReader: receipts });
  return { cards, candles, accounts, receipts, close() { cards.stop(); db.close(); } };
}

it("keeps Chart guidance on its actual selection until that selection is admitted", async () => {
  const f = await storedReadCardFixture();
  try {
    const card = await f.cards.create("chart", { interval: "1d", limit: 7 }); let refuse = true;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.submit && refuse) throw new Error("Fixture selection delivery failure");
      return cardToolResult(name === CARD_TOOLS.read ? await f.cards.read(cardReferenceSchema.parse(args)) :
        await f.cards.submit(cardSubmissionSchema.parse(args)));
    });
    startCard("chart", chartRenderer); app.ontoolresult!(cardCreation(card, card.permission));
    await vi.waitFor(() => expect(root.querySelector("form")).toBeDefined());
    expect(visibleGuidance()).toBe("");
    const pair = root.querySelectorAll("select")[0]!; pair.value = "SUI_USDC"; pair.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(visibleGuidance()).toContain("To retry, clear the pair"));
    expect(pair.disabled).toBe(false); expect(visibleGuidance()).not.toContain("new chart");
    expect(f.candles).not.toHaveBeenCalled();
    refuse = false; pair.value = ""; pair.dispatchEvent(new Event("change")); pair.value = "SUI_USDC"; pair.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(root.textContent).toContain("No candles returned"));
    expect(f.candles).toHaveBeenCalledOnce(); expect(root.querySelector("form")).toBeUndefined();
    expect(visibleGuidance()).not.toContain("To retry, clear the pair");
    expect(await f.cards.readSaved(card.snapshot.cardId)).toMatchObject({ state: "closed", input: { poolName: "SUI_USDC", interval: "1d", limit: 7 } });
    await app.onteardown!();
    // The same public/unsubmitted shape has no editable form or implied access.
    const publicCard = await f.cards.create("chart", { interval: "1d", limit: 7 });
    const publicApp = host(async () => { throw new Error("Public card cannot invoke actions"); });
    publicApp.readServerResource.mockImplementation(async () => savedResource(await f.cards.readSaved(publicCard.snapshot.cardId)));
    startCard("chart", chartRenderer); publicApp.ontoolresult!(cardToolResult(publicCard));
    await vi.waitFor(() => expect(root.textContent).toContain("View only."));
    expect(root.querySelector("form")).toBeUndefined(); expect(root.textContent).not.toContain("To retry, clear the pair");
    expect(visibleGuidance()).toBe("Ask in chat for a new chart with the pair and time range you want.");
    expect(f.candles).toHaveBeenCalledOnce(); expect(publicApp.callServerTool).not.toHaveBeenCalled();
    await publicApp.onteardown!();
  } finally { f.close(); }
});

it.each(["account", "receipt"] as const)("recovers a stored %s display explicitly without repeating its business query", async (kind) => {
  const f = await storedReadCardFixture();
  const disconnects: ReturnType<typeof vi.fn>[] = [];
  vi.stubGlobal("MutationObserver", class {
    disconnect = vi.fn();
    constructor() { disconnects.push(this.disconnect); }
    observe() {}
  });
  const create = document.createElement.bind(document); let failDisplay = true, refuseRead = false;
  const dom = vi.spyOn(document, "createElement").mockImplementation(((name: string) => {
    if (name === "details" && failDisplay) throw new Error("Fixture DOM creation failure");
    return create(name);
  }) as typeof document.createElement);
  try {
    const card = await f.cards.create(kind, kind === "receipt" ? { digest: chainReceiptDigest } : { account: `0x${"a".repeat(64)}` }, true);
    const app = host(async ({ name, arguments: args }) => {
      expect(name).toBe(CARD_TOOLS.read);
      if (refuseRead) throw new Error("Fixture status read failure");
      return cardToolResult(await f.cards.read(cardReferenceSchema.parse(args)));
    });
    startCard(kind, kind === "receipt" ? receiptRenderer : accountRenderer); app.ontoolresult!(cardCreation(card, card.permission));
    await vi.waitFor(() => expect(app.callServerTool).toHaveBeenCalledOnce());
    expect(root.textContent).toContain("This card could not be displayed.");
    expect(recoveryButton("Check status")?.disabled).toBe(false);
    expect(visibleGuidance()).toContain("try displaying it again");
    if (kind === "receipt") expect(disconnects.length).toBeGreaterThan(0);
    for (const dispose of disconnects) expect(dispose).toHaveBeenCalledOnce();
    const source = kind === "receipt" ? f.receipts : f.accounts;
    expect(source).toHaveBeenCalledOnce();
    failDisplay = false; refuseRead = true;
    recoveryButton("Check status")!.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Fixture status read failure"));
    expect(root.textContent).toContain("This card could not be displayed.");
    await vi.advanceTimersByTimeAsync(60_000); expect(app.callServerTool).toHaveBeenCalledTimes(2);
    refuseRead = false; recoveryButton("Check status")!.click();
    await vi.waitFor(() => expect(root.textContent).toContain(kind === "receipt" ? "Transaction succeeded on Sui" : "No token balances were returned."));
    expect(root.textContent).not.toContain("This card could not be displayed.");
    expect(recoveryButton("Check status")).toBeUndefined(); expect(source).toHaveBeenCalledOnce();
    expect((await f.cards.readSaved(card.snapshot.cardId)).state).toBe("closed");
    await app.onteardown!(); expect(vi.getTimerCount()).toBe(0);
    for (const dispose of disconnects) expect(dispose).toHaveBeenCalledOnce();
  } finally { dom.mockRestore(); f.close(); }
});

it.each([false, true])("retries only the failed QR after an explicit current read (read failure: %s)", async (failRead) => {
  const f = await walletWorkflowFixture(), mcp = await savedWorkflowMcp(f), show = visibleFrame();
  const paint = vi.mocked(QRCode.toCanvas); paint.mockRejectedValueOnce(new Error("Fixture canvas failure"));
  try {
    const created = await f.createConnection(); await f.act(created, { action: "connect" });
    await vi.waitFor(() => expect(f.connect).toHaveBeenCalledOnce());
    const card = await f.read(created); let refuse = false;
    const app = host(async (request) => { if (refuse) throw new Error("Fixture QR status read failure"); return mcp.call(request); });
    startCard("connect", connectRenderer); app.ontoolresult!(cardCreation(card, created.permission));
    await vi.waitFor(() => expect(root.textContent).toContain("The QR code could not be displayed."));
    expect(root.querySelector(".workflow-qr")?.hidden).toBe(true);
    expect(root.querySelector(".workflow-qr-instruction")?.hidden).toBe(true);
    expect(root.querySelectorAll("[data-card-action]").find((item) => item.dataset.cardAction === "stop_connection")?.disabled).toBe(false);
    show("hidden"); show("visible"); await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 2);
    expect(paint).toHaveBeenCalledOnce(); expect(recoveryButton("Check status")?.disabled).toBe(false);
    if (failRead) {
      refuse = true; recoveryButton("Check status")!.click();
      await vi.waitFor(() => expect(root.textContent).toContain("Fixture QR status read failure"));
      expect(paint).toHaveBeenCalledOnce(); show("hidden"); show("visible");
      await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs * 2); expect(paint).toHaveBeenCalledOnce();
      refuse = false;
    }
    recoveryButton("Check status")!.click();
    await vi.waitFor(() => expect(paint).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(root.textContent).not.toContain("The QR code could not be displayed."));
    expect(root.querySelector(".workflow-qr")?.hidden).toBe(false);
    expect(root.querySelector(".workflow-qr-instruction")?.hidden).toBe(false);
    expect(paint.mock.calls[1]?.[1]).toBe(card.walletDisplay!.pairingUri);
    expect(recoveryButton("Check status")).toBeUndefined();
    expect(f.connect).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!(); expect(vi.getTimerCount()).toBe(0);
  } finally { await mcp.close(); f.close(); }
});

it("does not offer QR repainting when a public saved view has no private QR material", async () => {
  const f = await walletWorkflowFixture(), mcp = await savedWorkflowMcp(f);
  try {
    const card = await f.createConnection(); await f.act(card, { action: "connect" });
    await vi.waitFor(() => expect(f.connect).toHaveBeenCalledOnce());
    const app = host(mcp.call); app.readServerResource.mockImplementation(mcp.readResource);
    startCard("connect", connectRenderer); app.ontoolresult!(cardToolResult(await f.read(card)));
    await vi.waitFor(() => expect(root.textContent).toContain("The QR code is not available in this view."));
    recoveryButton("Check status")!.click(); await vi.waitFor(() => expect(app.readServerResource).toHaveBeenCalledTimes(2));
    expect(root.textContent).not.toContain("try displaying it again"); expect(root.textContent).not.toContain("Switch to another chat");
    expect(root.querySelectorAll("canvas")).toHaveLength(0); expect(QRCode.toCanvas).not.toHaveBeenCalled();
    expect(app.callServerTool).not.toHaveBeenCalled(); expect(f.connect).toHaveBeenCalledOnce();
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { await mcp.close(); f.close(); }
});

it("ignores a late failed QR painting after the same connection has completed", async () => {
  const f = await walletWorkflowFixture(), mcp = await savedWorkflowMcp(f), painting = deferred<void>();
  vi.mocked(QRCode.toCanvas).mockImplementationOnce(() => painting.promise);
  try {
    const card = await f.createConnection(); await f.act(card, { action: "connect" });
    await vi.waitFor(() => expect(f.connect).toHaveBeenCalledOnce());
    const app = host(mcp.call); startCard("connect", connectRenderer); app.ontoolresult!(cardCreation(await f.read(card), card.permission));
    await vi.waitFor(() => expect(QRCode.toCanvas).toHaveBeenCalledOnce());
    f.approval.resolve({ topic: "fixture-topic", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet",
      expiresAt: new Date(f.now().getTime() + 1_800_000).toISOString(), walletName: "Fixture Wallet" });
    await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs);
    await vi.waitFor(() => expect(root.textContent).toContain("Wallet connected"));
    painting.reject(new Error("Late canvas failure")); await vi.advanceTimersByTimeAsync(0);
    expect(root.textContent).not.toContain("The QR code could not be displayed.");
    expect(root.querySelectorAll("canvas")).toHaveLength(0); expect(recoveryButton("Check status")).toBeUndefined();
    expect(f.connect).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
  } finally { await mcp.close(); f.close(); }
});

it.each(["older", "identity"] as const)("does not repaint a failed QR from a %s recovery response", async (failure) => {
  const f = await walletWorkflowFixture(), mcp = await savedWorkflowMcp(f);
  const paint = vi.mocked(QRCode.toCanvas); paint.mockRejectedValueOnce(new Error("Fixture canvas failure"));
  try {
    const card = await f.createConnection(); await f.act(card, { action: "connect" });
    await vi.waitFor(() => expect(f.connect).toHaveBeenCalledOnce());
    const pending = await f.read(card); expect(pending.snapshot.revision).toBeGreaterThan(card.snapshot.revision);
    let override = false;
    const app = host(async (request) => override ? cardToolResult(failure === "older" ? card : {
      ...pending, snapshot: { ...pending.snapshot, cardId: "different-card" }
    }) : mcp.call(request));
    startCard("connect", connectRenderer); app.ontoolresult!(cardCreation(pending, card.permission));
    await vi.waitFor(() => expect(recoveryButton("Check status")).toBeDefined());
    override = true; const calls = app.callServerTool.mock.calls.length;
    recoveryButton("Check status")!.click();
    await vi.waitFor(() => expect(app.callServerTool).toHaveBeenCalledTimes(calls + 1)); await vi.advanceTimersByTimeAsync(0);
    expect(paint).toHaveBeenCalledOnce(); expect(f.connect).toHaveBeenCalledOnce();
    if (failure === "older") {
      expect(recoveryButton("Check status")?.disabled).toBe(false);
      expect(root.textContent).toContain("The QR code could not be displayed.");
    } else {
      expect(root.textContent).toContain("does not match this card");
      expect(recoveryButton("Check status")).toBeUndefined();
      expect(root.querySelectorAll("[data-card-action]").every((node) => node.disabled)).toBe(true);
    }
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { await mcp.close(); f.close(); }
});

it("displays a QR only when bound private material actually arrives", async () => {
  const f = await walletWorkflowFixture(), mcp = await savedWorkflowMcp(f), show = visibleFrame();
  try {
    const card = await f.createConnection(); await f.act(card, { action: "connect" });
    await vi.waitFor(() => expect(f.connect).toHaveBeenCalledOnce());
    const pending = await f.read(card); let provide = false;
    expect(pending.walletDisplay?.connectionId).toBe(workflowViewSchema.parse(pending.snapshot.data).connection!.connectionId);
    const withoutQr = { snapshot: pending.snapshot };
    const app = host(async (request) => provide ? mcp.call(request) : cardToolResult(withoutQr));
    startCard("connect", connectRenderer); app.ontoolresult!(cardCreation(withoutQr, card.permission));
    await vi.waitFor(() => expect(root.textContent).toContain("The QR code is not available in this view."));
    expect(QRCode.toCanvas).not.toHaveBeenCalled();
    provide = true; show("hidden"); show("visible");
    await vi.waitFor(() => expect(QRCode.toCanvas).toHaveBeenCalledOnce());
    expect(root.textContent).not.toContain("The QR code is not available in this view.");
    expect(f.connect).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
  } finally { await mcp.close(); f.close(); }
});

it("recovers a real Review display without recalculating or changing its approval target", async () => {
  const f = await walletWorkflowFixture(), mcp = await savedWorkflowMcp(f);
  const disconnects: ReturnType<typeof vi.fn>[] = [];
  vi.stubGlobal("MutationObserver", class {
    disconnect = vi.fn();
    constructor() { disconnects.push(this.disconnect); }
    observe() {}
  });
  const create = document.createElement.bind(document); let failDisplay = true;
  const dom = vi.spyOn(document, "createElement").mockImplementation(((name: string) => {
    if (name === "div" && failDisplay && disconnects.length > 0) throw new Error("Fixture review DOM failure");
    return create(name);
  }) as typeof document.createElement);
  try {
    const { connection } = await f.approve(), { card, session } = await f.prepare(connection.connectionId);
    const app = host(mcp.call); startCard("review", reviewRenderer); app.ontoolresult!(cardCreation(card, card.permission));
    await vi.waitFor(() => expect(root.textContent).toContain("This card could not be displayed."));
    expect(recoveryButton("Check status")?.disabled).toBe(false); expect(f.quote).toHaveBeenCalledOnce();
    expect(disconnects.length).toBeGreaterThan(0);
    for (const dispose of disconnects) expect(dispose).toHaveBeenCalledOnce();
    failDisplay = false; recoveryButton("Check status")!.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Ready for your review"));
    expect(root.textContent).not.toContain("This card could not be displayed.");
    expectReviewAccount(f.account);
    expect(root.querySelectorAll("button").find((node) => node.dataset.cardAction === "request_signature")?.disabled).toBe(false);
    expect(f.run(() => f.sessions.readReviewSession(session.id))?.reviewRevision).toBe(session.reviewRevision);
    expect(f.quote).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    await app.onteardown!();
    for (const dispose of disconnects) expect(dispose).toHaveBeenCalledOnce();
  } finally { dom.mockRestore(); await mcp.close(); f.close(); }
});

it("describes an unestimated internal receive amount without presenting an unknown amount as a quote", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { session } = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    expect(f.plan.assetFlowPreview.expectedIncoming).toEqual([{ symbol: "USDC", amount: "unknown", amountKind: "display_intent", approx: true }]);
    const card = await f.run(() => f.cards.create("review", { reviewSessionId: session.id }));
    const view = reviewRenderer.result(card.snapshot, undefined, undefined);
    expect(factValues(view.node as unknown as Element, "Receive asset")).toEqual(["USDC · amount not estimated yet"]);
    expect(factValues(view.node as unknown as Element, "Expected to receive")).toEqual([]);
    expect(view.node.textContent).not.toContain("unknown USDC");
    expect(f.quote).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    view.dispose?.();
  } finally { f.close(); }
});

it.each(["success", "failure", "teardown"] as const)("shows neutral pre-admission guidance during a finite disconnect reply (%s)", async (ending) => {
  const f = await walletWorkflowFixture(), reply = deferred<void>();
  try {
    await f.approve(); const card = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    const app = host(async ({ name, arguments: input }) => {
      if (name === CARD_TOOLS.act) { await reply.promise; if (ending === "failure") throw new Error("Fixture delivery refused"); }
      return cardToolResult(await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(input)) : f.cards.act(input as any)));
    });
    startCard("connect", connectRenderer); app.ontoolresult!(cardCreation(card, card.permission));
    const control = (label: string) => root.querySelectorAll("button").find((item) => item.textContent === label);
    await vi.waitFor(() => expect(control("Disconnect")?.disabled).toBe(false)); control("Disconnect")!.click();
    control("Confirm disconnect")!.click();
    await vi.waitFor(() => expect(visibleGuidance()).toContain("Waiting for a response…"));
    expect(visibleGuidance()).toContain("check this same request");
    expect(control("Confirm disconnect")!.disabled).toBe(true);
    expect(root.querySelectorAll("summary").some((item) => item.textContent === "Wallet service help")).toBe(false);
    control("Back")!.click();
    expect(control("Disconnect")!.disabled).toBe(true);
    expect(control("Restart wallet service")).toBeUndefined();
    expect(visibleGuidance()).toContain("Waiting for a response…");
    control("Disconnect")!.click();
    expect(control("Confirm disconnect")).toBeUndefined(); expect(control("Confirm restart")).toBeUndefined();
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
    expect(f.run(() => f.cardRecords.get(card.snapshot.cardId)?.state.state)).toBe("ready");
    expect(f.transport.disconnect).not.toHaveBeenCalled();
    if (ending === "teardown") await app.onteardown!();
    reply.resolve(); await vi.advanceTimersByTimeAsync(0);
    if (ending === "success") await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs);
    if (ending === "success") await vi.waitFor(() => expect(root.textContent).toContain("Wallet disconnected"));
    if (ending === "failure") await vi.waitFor(() => expect(root.textContent).toContain("Fixture delivery refused"));
    expect(visibleGuidance()).not.toContain("Waiting for a response…");
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
    await app.onteardown!();
  } finally { reply.resolve(); f.close(); }
});

it("distinguishes an unconfirmed disconnect from the earlier successful connection in visible result guidance", async () => {
  const f = await walletWorkflowFixture(), held = deferred<void>();
  try {
    const { card: connected, connection } = await f.approve();
    vi.mocked(f.transport.disconnect).mockImplementationOnce(() => held.promise);
    const card = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    await f.act(card, { action: "disconnect", connectionId: connection.connectionId });
    const pending = await f.read(card);
    const context = { confirmed: true, readOnly: false, recoveryNeeded: false, approvalUnresolved: false, automaticPaused: false };
    expect(connectRenderer.guidance(pending.snapshot, context)).toContain("If this disconnection is not responding");
    held.reject(new Error("Fixture disconnect not confirmed"));
    await vi.waitFor(() => expect(f.run(() => f.records.connection(connection.connectionId)?.sdkPending)).toBe(false));
    const failed = await f.read(card), historical = await f.read(connected);
    const view = connectRenderer.result(failed.snapshot, undefined, undefined);
    expect(factValues(view.node as unknown as Element, "Status")).toEqual(["Disconnection could not be confirmed"]);
    expect(view.node.textContent).toContain("could not be confirmed");
    expect(connectRenderer.guidance(failed.snapshot, context)).toContain("wallet app and remove it there");
    expect(connectRenderer.guidance(failed.snapshot, context)).not.toContain("connect your wallet");
    const prior = connectRenderer.result(historical.snapshot, undefined, undefined);
    expect(factValues(prior.node as unknown as Element, "Status")).toEqual(["Wallet connection unavailable"]);
    expect(prior.node.textContent).not.toContain("Connection could not be completed");
    held.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect((await f.read(card)).snapshot.data).toMatchObject({ connection: { status: "failed" }, connectionAction: "disconnect" });
    expect(f.transport.disconnect).toHaveBeenCalledOnce(); view.dispose?.(); prior.dispose?.();
  } finally { held.resolve(); f.close(); }
});

it("keeps an expired review's next step ahead of unrelated service recovery", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { session } = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    const card = await f.run(() => f.cards.create("review", { reviewSessionId: session.id }));
    f.advance(Date.parse(session.expiresAt) - f.now().getTime() + 1);
    f.runtime.block("initialization_failed");
    const ended = await f.read(card);
    expect(reviewRenderer.guidance(ended.snapshot, { confirmed: true, readOnly: false, recoveryNeeded: true,
      approvalUnresolved: false, automaticPaused: false })).toBe("Ask in chat for a new transaction review.");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  } finally { f.close(); }
});

it("keeps disconnect confirmation and Details in the same View across reads and Back", async () => {
  const f = await walletWorkflowFixture();
  const visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility); document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  try {
    await f.approve(); const card = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    const controls = vi.fn(connectRenderer.controls), guidance = vi.fn(connectRenderer.guidance);
    const app = host(async ({ arguments: input }) => cardToolResult(await f.run(() => f.cards.read(cardReferenceSchema.parse(input)))));
    startCard("connect", { ...connectRenderer, controls, guidance }); app.ontoolresult!(cardCreation(card, card.permission));
    const control = (label: string) => root.querySelectorAll("button").find((item) => item.textContent === label);
    await vi.waitFor(() => expect(control("Disconnect")?.disabled).toBe(false));
    const view: CardContent = controls.mock.results[0]!.value;
    const details = root.querySelectorAll("details").find((item) => item.querySelector("summary")?.textContent === "Details")!;
    details.open = true; const revision = card.snapshot.revision;
    control("Disconnect")!.click();
    expect(view.visibleConfirmation?.()).toBe("disconnect"); expect(visibleGuidance()).toBe("");
    expect(control("Confirm disconnect")?.disabled).toBe(false);
    for (const state of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", { value: state, writable: true }); visibility.dispatchEvent(new Event("visibilitychange"));
    }
    await vi.waitFor(() => expect(app.callServerTool).toHaveBeenCalledTimes(2));
    expect(controls).toHaveBeenCalledOnce(); expect(view.visibleConfirmation?.()).toBe("disconnect");
    expect(guidance.mock.calls.at(-1)?.[1].visibleConfirmation).toBe("disconnect");
    control("Back")!.click();
    expect(view.visibleConfirmation?.()).toBeUndefined(); expect(root.querySelectorAll("details")).toContain(details); expect(details.open).toBe(true);
    expect(f.run(() => f.cardRecords.get(card.snapshot.cardId)!.state.revision)).toBe(revision);
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(0);
    expect(f.transport.disconnect).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { f.close(); }
});

it("keeps automatic disconnect confirmation factual during pending transport and a read error", async () => {
  const f = await walletWorkflowFixture(), reply = deferred<void>();
  const visibility = new EventTarget();
  document.addEventListener = visibility.addEventListener.bind(visibility); document.removeEventListener = visibility.removeEventListener.bind(visibility);
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
  let failRead = false;
  try {
    await f.approve(); const card = await f.run(() => f.cards.create("connect", { intent: "disconnect" }));
    const controls = vi.fn(connectRenderer.controls), guidance = vi.fn(connectRenderer.guidance);
    const app = host(async ({ name, arguments: input }) => {
      if (name === CARD_TOOLS.read && failRead) throw new Error("Fixture confirmation state read failed");
      if (name === CARD_TOOLS.act) { await reply.promise; throw new Error("Fixture disconnect delivery failed"); }
      return cardToolResult(await f.run(() => f.cards.read(cardReferenceSchema.parse(input))));
    });
    startCard("connect", { ...connectRenderer, controls, guidance }); app.ontoolresult!(cardCreation(card, card.permission));
    const control = (label: string) => root.querySelectorAll("button").find((item) => item.textContent === label);
    await vi.waitFor(() => expect(control("Confirm disconnect")?.disabled).toBe(false));
    const view: CardContent = controls.mock.results[0]!.value;
    expect(view.visibleConfirmation?.()).toBe("disconnect");
    control("Confirm disconnect")!.click();
    expect(control("Confirm disconnect")!.disabled).toBe(true);
    expect(view.visibleConfirmation?.()).toBe("disconnect");
    expect(guidance.mock.calls.at(-1)?.[1]).toMatchObject({ visibleConfirmation: "disconnect", commandPending: { phase: "sending", action: "disconnect" } });
    expect(visibleGuidance()).toContain("Waiting for a response…");
    reply.resolve(); await vi.waitFor(() => expect(root.textContent).toContain("Fixture disconnect delivery failed"));
    // The failed command pauses the View. Its confirmed read replaces the
    // old content; explicitly reopen the current controls before testing a
    // read error while a confirmation is actually displayed.
    await vi.waitFor(() => expect(control("Disconnect")?.disabled).toBe(false));
    expect(view.visibleConfirmation?.()).toBeUndefined();
    control("Disconnect")!.click();
    const currentView: CardContent = controls.mock.results.at(-1)!.value;
    expect(currentView.visibleConfirmation?.()).toBe("disconnect");
    failRead = true;
    for (const value of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", { value, writable: true }); visibility.dispatchEvent(new Event("visibilitychange"));
    }
    await vi.waitFor(() => expect(visibleGuidance()).toContain("Use Check status"));
    expect(control("Confirm disconnect")?.disabled).toBe(true);
    expect(currentView.visibleConfirmation?.()).toBe("disconnect");
    failRead = false; control("Check status")!.click();
    await vi.waitFor(() => expect(control("Confirm disconnect")?.disabled).toBe(false));
    f.advance(card.snapshot.inputRemainingMs + 1);
    for (const value of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", { value, writable: true }); visibility.dispatchEvent(new Event("visibilitychange"));
    }
    await vi.waitFor(() => expect(control("Confirm disconnect")).toBeUndefined());
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
    expect(f.transport.disconnect).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { reply.resolve(); f.close(); }
});

it("discards a disposed confirmation and its callbacks before a new View uses the same card", async () => {
  const f = await walletWorkflowFixture();
  try {
    await f.approve();
    const card = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    const handler = async ({ name, arguments: input }: { name: string; arguments: Record<string, unknown> }) =>
      cardToolResult(await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(input)) : f.cards.act(input as any)));
    const controls = vi.fn(connectRenderer.controls), first = host(handler);
    startCard("connect", { ...connectRenderer, controls }); first.ontoolresult!(cardCreation(card, card.permission));
    const control = (label: string) => root.querySelectorAll("button").find((item) => item.textContent === label);
    await vi.waitFor(() => expect(control("Disconnect")?.disabled).toBe(false)); control("Disconnect")!.click();
    const oldView: CardContent = controls.mock.results[0]!.value, oldBack = control("Back")!;
    expect(oldView.visibleConfirmation?.()).toBe("disconnect"); await first.onteardown!();
    expect(oldView.visibleConfirmation?.()).toBeUndefined();
    root = new Element("main"); const returned = host(handler);
    startCard("connect", connectRenderer); returned.ontoolresult!(cardCreation(card, card.permission));
    await vi.waitFor(() => expect(control("Disconnect")?.disabled).toBe(false));
    expect(control("Confirm disconnect")).toBeUndefined();
    const reads = returned.callServerTool.mock.calls.length, current = root.textContent;
    oldBack.click(); await vi.advanceTimersByTimeAsync(0);
    expect(root.textContent).toBe(current); expect(returned.callServerTool).toHaveBeenCalledTimes(reads);
    expect(f.run(() => f.cardRecords.get(card.snapshot.cardId)?.acceptedInput)).toBeUndefined();
    await returned.onteardown!();
  } finally { f.close(); }
});

it("resolves a visible connection conflict with one exact Disconnect and returns to single-wallet controls", async () => {
  const f = await walletWorkflowFixture(), held = deferred<void>();
  let close: (() => unknown) | undefined;
  try {
    let sessions = ["a", "b"].map((topic) => ({ topic, accounts: [f.account], methods: ["sui_signTransaction"],
      chain: "sui:mainnet" as const, expiresAt: new Date(f.now().getTime() + 60000).toISOString(), walletName: "Same wallet" }));
    const targets = sessions.map((session) => f.run(() => f.records.restoreConnection(session, f.now())).connection);
    vi.spyOn(f.transport, "session").mockImplementation((topic) => sessions.find((session) => session.topic === topic));
    vi.spyOn(f.transport, "inspectAll").mockImplementation(() => sessions.map((session) => ({ topic: session.topic, status: "present", session })));
    vi.mocked(f.transport.disconnect).mockImplementation(async (topic) => { await held.promise; sessions = sessions.filter((session) => session.topic !== topic); });
    f.observe();
    const card = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    const app = host(async ({ name, arguments: args }) => cardToolResult(await f.run(() =>
      name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any))));
    close = app.onteardown; startCard("connect", connectRenderer); app.ontoolresult!(cardCreation(card, card.permission));
    await vi.waitFor(() => expect(root.textContent).toContain("More than one wallet connection is saved."));
    expect(root.querySelectorAll("select")).toHaveLength(0);
    expect(root.querySelectorAll("summary").map((item) => item.textContent)).not.toContain("Wallet service help");
    const buttons = root.querySelectorAll("button");
    expect(buttons.filter((item) => item.textContent === "Disconnect")).toHaveLength(2);
    expect(buttons.some((item) => item.textContent === "Use address" || item.textContent === "Connect wallet")).toBe(false);
    for (const target of targets) expect(root.textContent).toContain(target.connectionId);
    buttons.find((item) => item.textContent === "Disconnect")!.click();
    expect(f.transport.disconnect).not.toHaveBeenCalled();
    const targetId = factValues(root, "Connection")[0]!;
    const selected = targets.findIndex((target) => target.connectionId === targetId);
    expect(selected).not.toBe(-1);
    root.querySelectorAll("button").find((item) => item.textContent === "Confirm disconnect")!.click();
    await vi.waitFor(() => expect(f.transport.disconnect).toHaveBeenCalledExactlyOnceWith(selected === 0 ? "a" : "b"));
    await vi.waitFor(() => expect(visibleGuidance()).toContain("fully quit all apps"));
    expect(root.textContent).toContain("Disconnecting wallet…");
    expect(factValues(root, "Connection")).toEqual([targetId]);
    held.resolve(); await vi.advanceTimersByTimeAsync(card.snapshot.pollAfterMs);
    await vi.waitFor(() => expect(root.textContent).toContain("Wallet disconnected"));
    expect(visibleGuidance()).toContain("manage the remaining connection");
    expect(factValues(root, "Connection")).toEqual([targetId]);
    expect(factValues(root, "Wallet")).toEqual(["Same wallet"]);
    await close?.(); close = undefined; root = new Element("main");
    const next = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    const nextApp = host(async ({ arguments: args }) => cardToolResult(await f.run(() => f.cards.read(cardReferenceSchema.parse(args)))));
    close = nextApp.onteardown; startCard("connect", connectRenderer); nextApp.ontoolresult!(cardCreation(next, next.permission));
    await vi.waitFor(() => expect(root.querySelectorAll("button").some((item) => item.textContent === "Use address")).toBe(true));
    expect(root.textContent).not.toContain("More than one wallet connection");
    expect(root.querySelectorAll("select")).toHaveLength(0);
    expect(f.connect).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  } finally { held.resolve(); await close?.(); f.close(); }
});

it("starts manage pairing only from its visible Connect wallet button and retries after a fresh read", async () => {
  const f = await walletWorkflowFixture();
  try {
    const card = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    let refuse = true;
    const app = host(async ({ name, arguments: args }) => {
      if (name === CARD_TOOLS.act && refuse) { refuse = false; throw new Error("Fixture manual connection delivery failed"); }
      return cardToolResult(await f.run(() => name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any)));
    });
    startCard("connect", connectRenderer); app.ontoolresult!(cardCreation(card, card.permission));
    const connect = () => root.querySelectorAll("button").find((item) => item.textContent === "Connect wallet");
    await vi.waitFor(() => expect(connect()?.disabled).toBe(false)); expect(f.connect).not.toHaveBeenCalled();
    connect()!.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Fixture manual connection delivery failed"));
    await vi.waitFor(() => expect(connect()?.disabled).toBe(false)); expect(f.connect).not.toHaveBeenCalled();
    const reads = app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.read).length;
    connect()!.click(); await vi.waitFor(() => expect(f.connect).toHaveBeenCalledOnce());
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.read).length).toBeGreaterThan(reads);
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(2);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { f.close(); }
});

it("offers explicit Use address when the saved same address belongs to another connection", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve();
    await f.run(() => f.activity.setActiveAccount(f.account, "wallet_connection", f.now(), { id: "previous-connection" }));
    const { session } = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    const review = await f.run(() => f.cards.create("review", { reviewSessionId: session.id }));
    expect(workflowViewSchema.parse(review.snapshot.data).automaticAction).toBeUndefined();
    const card = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    const app = host(async ({ name, arguments: args }) => cardToolResult(await f.run(() =>
      name === CARD_TOOLS.read ? f.cards.read(cardReferenceSchema.parse(args)) : f.cards.act(args as any))));
    startCard("connect", connectRenderer); app.ontoolresult!(cardCreation(card, card.permission));
    const use = () => root.querySelectorAll("button").find((item) => item.textContent === "Use address");
    await vi.waitFor(() => expect(use()?.disabled).toBe(false));
    expect(root.querySelectorAll("select")).toHaveLength(0);
    use()!.click();
    await vi.waitFor(async () => expect(await f.run(() => f.activity.getActiveAccount())).toMatchObject({ walletId: connection.connectionId }));
    expect(workflowViewSchema.parse((await f.read(review)).snapshot.data).automaticAction).toMatchObject({ action: "prepare_review", connectionId: connection.connectionId });
    expect(app.callServerTool.mock.calls.filter(([call]) => call.name === CARD_TOOLS.act)).toHaveLength(1);
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); await app.onteardown!();
  } finally { f.close(); }
});

it("renders the backend's single usable choice while an expired connected record remains manageable", async () => {
  const f = await walletWorkflowFixture();
  try {
    const { connection } = await f.approve();
    const historical = f.run(() => f.records.restoreConnection({ topic: "recorded-expired", accounts: [f.account], methods: ["sui_signTransaction"],
      chain: "sui:mainnet", expiresAt: new Date(f.now().getTime() - 1).toISOString(), walletName: connection.walletName }, f.now())).connection;
    await f.run(() => f.activity.clearActiveAccount(f.now()));
    let card = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    const act = vi.fn(), controls = connectRenderer.controls(card.snapshot, act, undefined), node = controls.node as unknown as Element;
    expect(node.querySelectorAll("button").filter((item) => item.textContent === "Disconnect")).toHaveLength(2);
    expect(node.textContent).toContain("Recorded connection. It is not available for account use.");
    expect(factValues(node, "Connection").sort()).toEqual([connection.connectionId, historical.connectionId].sort());
    expect(node.querySelectorAll("select")).toHaveLength(0);
    node.querySelectorAll("button").find((item) => item.textContent === "Use address")!.click();
    expect(act).toHaveBeenCalledExactlyOnceWith({ action: "use_account", walletRunId: f.runtime.runId, connectionId: connection.connectionId, account: f.account });
    controls.dispose();
    // Set the source without another SDK check so this is still the observation gap.
    await f.run(() => f.activity.setActiveAccount(f.account, "wallet_connection", f.now(), { id: connection.connectionId }));
    const { session } = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    const review = await f.run(() => f.cards.create("review", { reviewSessionId: session.id }));
    const data = workflowViewSchema.parse(review.snapshot.data);
    expect(data.automaticAction).toMatchObject({ action: "prepare_review", connectionId: connection.connectionId });
    const rendered = reviewRenderer.controls(review.snapshot, vi.fn(), undefined);
    expect(rendered.node.textContent).not.toContain("No wallet connection is available");
    expect(rendered.node.textContent).toContain("Fixture Wallet"); rendered.dispose();
    f.advance(Date.parse(connection.expiresAt) - f.now().getTime());
    card = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    const expired = connectRenderer.controls(card.snapshot, vi.fn(), undefined);
    expect(expired.node.textContent).toContain("No usable wallet connection");
    expect((expired.node as unknown as Element).querySelectorAll("button").some((item) => item.textContent === "Connect wallet")).toBe(true);
    expect(factValues(expired.node as unknown as Element, "Connection").sort()).toEqual([connection.connectionId, historical.connectionId].sort());
    (expired.node as unknown as Element).querySelectorAll("button").find((item) => item.textContent === "Disconnect")!.click();
    expect(factValues(expired.node as unknown as Element, "Connection")).toHaveLength(1);
    expired.dispose(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  } finally { f.close(); }
});
