import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { WalletCommand, WalletEvent } from "../src/runtime/walletSdkIpc.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createRuntimeApplication } from "../src/runtime/application.js";
import { loadBootConfig } from "../src/runtime/config.js";
import { TOOL_NAMES } from "../src/mcp/toolNames.js";
import { CARD_METADATA_KEY, CARD_TOOLS } from "../src/mcp-ui/contracts.js";
import { WALLETCONNECT_PROJECT_ID } from "../src/runtime/walletConnectConfig.js";
import { walletAvailabilitySchema, walletUnavailableReasonSchema } from "../src/core/session/walletConnection.js";
import { SUI_MAINNET_CHAIN_IDENTIFIER } from "../src/runtime/suiEndpoint.js";
import type { ControlIdentity } from "../src/runtime/shared/control.js";
import { seedWalletSdk, walletRelay } from "./fixtures/walletRelay.js";
import { acquireDataDirectoryOwner } from "../src/runtime/shared/ownerLease.js";

// Fingerprint of the product owner's approved input, independent of the runtime constant.
const approvedProjectFingerprint = "0878d5895848f26e5631d667db9f5473ebaf875775af53f190467b50f810147d";
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

const source = vi.hoisted(() => ({ failure: "", init: vi.fn(), connect: vi.fn(), request: vi.fn(),
  exits: 0, realRelay: "", commands: [] as string[], children: [] as ChildProcess[], leases: [] as Array<Mock<() => void>> }));
// The parent, supervisor, SQLite, tools and MCP are real. Only the operating
// system child/IPC is a double here; real child/SDK tests cover that boundary.
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  return { ...actual, fork: () => {
    if (source.realRelay) {
      const child = actual.fork(new URL("./fixtures/walletSdkChild.ts", import.meta.url), [], {
        execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...process.env, FIXTURE_WALLET_RELAY: source.realRelay, FIXTURE_WALLET_SUBSCRIBED_READ: "1" }
      });
      const send = child.send.bind(child);
      child.send = ((message: WalletCommand, callback: (error: Error | null) => void) => {
        source.commands.push(message.type); return send(message, callback);
      }) as ChildProcess["send"];
      source.children.push(child); return child;
    }
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, { connected: true, pid: 100, exitCode: null, signalCode: null });
    child.send = ((message: WalletCommand, callback: (error: Error | null) => void) => {
      callback(null);
      if (message.type !== "init") throw new Error("Unexpected SDK command in startup test");
      void (async () => {
        const envelope = { protocolVersion: 1 as const, runId: message.runId };
        const emit = (event: WalletEvent) => child.emit("message", event);
        if (source.failure === "storage") { emit({ ...envelope, type: "failure", reason: "initialization_failed" }); return; }
        emit({ ...envelope, type: "stage", stage: "sdk_start" });
        try { await source.init({ ...message, logger: "silent", telemetryEnabled: false }); }
        catch { emit({ ...envelope, type: "failure", reason: "initialization_failed" }); return; }
        emit({ ...envelope, type: "stage", stage: "session_restore" });
        if (source.failure === "restore") { emit({ ...envelope, type: "failure", reason: "restoration_failed" }); return; }
        if (source.failure === "hold") return;
        emit({ ...envelope, type: "snapshot", ready: true, snapshot: { runId: message.runId, sequence: 1,
          observedAt: new Date().toISOString(), sessions: [] } });
      })();
      return true;
    }) as ChildProcess["send"];
    child.kill = (() => { queueMicrotask(() => {
      Object.assign(child, { connected: false, signalCode: "SIGKILL" }); source.exits += 1; child.emit("exit", null, "SIGKILL");
    }); return true; }) as ChildProcess["kill"];
    return child;
  } };
});
vi.mock("../src/runtime/suiEndpoint.js", async (original) => {
  const actual = await original<typeof import("../src/runtime/suiEndpoint.js")>();
  const { SuiGrpcClient } = await import("@mysten/sui/grpc");
  return { ...actual, verifyMainnetGrpcEndpoint: async () => ({
    client: new SuiGrpcClient({ network: "mainnet", baseUrl: "https://example.invalid" }),
    chainIdentifier: actual.SUI_MAINNET_CHAIN_IDENTIFIER
  }) };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readFile: (...args: Parameters<typeof actual.readFile>) => {
    if (source.failure === "metadata" && args[0] instanceof URL && args[0].pathname.endsWith("/package.json")) {
      return Promise.reject(new Error("PRIVATE-METADATA-DETAIL"));
    }
    return actual.readFile(...args);
  } };
});
vi.mock("../src/runtime/shared/ownerLease.js", async (original) => {
  const actual = await original<typeof import("../src/runtime/shared/ownerLease.js")>();
  return { ...actual, acquireDataDirectoryOwner: (path: string) => {
    const lease = actual.acquireDataDirectoryOwner(path), close = vi.fn(lease.close);
    source.leases.push(close); return { close };
  } };
});
// Replace only HTTP transport plumbing. The runtime factory, database, workflow,
// tool registration and MCP protocol are real, under the runtime's data guard.
vi.mock("../src/runtime/shared/mcpHttp.js", () => ({ createInternalMcpHandler: (factory: () => McpServer) => {
  let client: Client | undefined, server: McpServer | undefined;
  return {
    async handle(request: IncomingMessage, response: ServerResponse) {
      if (!client) {
        server = factory();
        client = new Client({ name: "startup-fixture", version: "1" }, { capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } });
        const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
      }
      const call = (request as unknown as { call: { name: string; arguments: Record<string, unknown> } }).call;
      (response as unknown as { result: unknown }).result = await client.callTool(call);
    },
    async close() { await client?.close(); await server?.close(); }
  };
} }));

beforeEach(() => {
  source.init.mockReset(); source.connect.mockReset(); source.request.mockReset(); source.failure = "";
  source.exits = 0;
  source.realRelay = ""; source.children = []; source.commands = [];
  source.init.mockImplementation(async () => {
    if (source.failure === "init") throw new Error("PRIVATE-SDK-DETAIL");
  });
});
afterEach(() => {
  for (const close of source.leases.splice(0)) close();
  vi.unstubAllEnvs();
});

it.each([
  { label: "unset environment", failure: "none", project: undefined, initCalls: 1, reason: undefined, message: undefined },
  { label: "invalid environment", failure: "none", project: "not-a-project-id", initCalls: 1, reason: undefined, message: undefined },
  { label: "different environment", failure: "none", project: "1".repeat(32), initCalls: 1, reason: undefined, message: undefined },
  { label: "metadata failure", failure: "metadata", project: undefined, initCalls: 0, reason: "initialization_failed", message: "could not start" },
  { label: "storage failure", failure: "storage", project: undefined, initCalls: 0, reason: "initialization_failed", message: "could not start" },
  { label: "SDK failure", failure: "init", project: undefined, initCalls: 1, reason: "initialization_failed", message: "could not start" },
  { label: "restore failure", failure: "restore", project: undefined, initCalls: 1, reason: "restoration_failed", message: "could not be restored" }
])("handles $label through the real runtime and MCP cards", async ({ failure, project, initCalls, reason, message }) => {
  source.failure = failure; vi.stubEnv("SAY_UR_INTENT_WALLETCONNECT_PROJECT_ID", project);
  const directory = mkdtempSync(join(tmpdir(), "say-startup-"));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = await createRuntimeApplication(loadBootConfig({ SAY_UR_INTENT_DATA_DIR: directory }), logger);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = {} as { result: CallToolResult };
    await app.handleMcp({ call: { name, arguments: args } } as unknown as IncomingMessage, response as unknown as ServerResponse);
    return response.result;
  };
  try {
    const created = await call(TOOL_NAMES.sessionCreateWalletConnection);
    expect(source.init).toHaveBeenCalledTimes(initCalls);
    expect(fingerprint(WALLETCONNECT_PROJECT_ID)).toBe(approvedProjectFingerprint);
    if (initCalls) {
      expect(fingerprint(source.init.mock.calls[0]![0].projectId)).toBe(approvedProjectFingerprint);
      expect(source.init.mock.calls[0]![0].metadata).toMatchObject({
        name: "@zktx.io/say-ur-intent",
        url: "https://github.com/zktx-mcp/say-ur-intent#readme"
      });
    }
    if (message) expect(JSON.stringify(created)).toContain(message);
    expect(created.isError).not.toBe(true);
    const interaction = await call(TOOL_NAMES.sessionGetInteractionStatus);
    const availability = (interaction.structuredContent as { data: { walletAvailability: unknown } }).data.walletAvailability;
    expect(walletAvailabilitySchema.parse(availability)).toMatchObject(reason ? { status: "unavailable", reason } : { status: "available" });
    {
      const card = (created.structuredContent as { data: { cardId: string; revision: number; state: string } }).data;
      expect(card.state).toBe("ready");
      if (message) {
        expect(JSON.stringify(await call(TOOL_NAMES.sessionGetWalletConnection, { cardId: card.cardId }))).toContain(message);
        expect(JSON.stringify(await call(TOOL_NAMES.sessionWaitWalletConnection, { cardId: card.cardId, timeoutMs: 1 }))).toContain(message);
        const ref = created._meta![CARD_METADATA_KEY] as Record<string, unknown>;
        expect(JSON.stringify(await call(CARD_TOOLS.act, { ...ref, revision: card.revision, input: { action: "connect", walletRunId: (availability as { walletRunId: string }).walletRunId } }))).toContain(message);
      }
    }
    expect((await call(TOOL_NAMES.accountGetActiveAccount)).isError).not.toBe(true);
    const receipt = await call(CARD_TOOLS.receipt);
    expect(receipt.isError).not.toBe(true);
    expect(receipt.structuredContent).toEqual({ ok: true, data: { kind: "receipt", status: "input_required", field: "digest", message: "Please provide a transaction hash in chat." } });
    expect(receipt._meta).toBeUndefined();
    expect(source.connect).not.toHaveBeenCalled(); expect(source.request).not.toHaveBeenCalled();
    expect(JSON.stringify([created, logger.error.mock.calls])).not.toContain("PRIVATE-");
    expect(JSON.stringify([created, logger.error.mock.calls]).includes(WALLETCONNECT_PROJECT_ID)).toBe(false);
    if (project) expect(JSON.stringify([created, logger.error.mock.calls])).not.toContain(project);
  } finally {
    await app.close();
    expect(source.leases.at(-1)).toHaveBeenCalledOnce();
    expect(source.exits).toBe(failure === "metadata" ? 0 : 1);
    for (const close of source.leases.splice(0)) close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("uses the same approved project identity for stdio peers regardless of old environment settings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "say-startup-identity-"));
  const controls: ControlIdentity[] = [];
  const processListeners = new Map(["SIGINT", "SIGTERM"].map((event) => [event, new Set(process.listeners(event))]));
  const inputListeners = new Map(["end", "close"].map((event) => [event, new Set(process.stdin.listeners(event))]));
  // Exercise start.ts and real control-key/identity generation. Only ownership
  // acquisition and the stdio bridge are replaced; no relay or port is opened.
  vi.doMock("../src/runtime/reviewServerAcquire.js", () => ({
    startOrDeferReviewServer: async () => ({ deferred: true, close: async () => {} })
  }));
  vi.doMock("../src/runtime/shared/stdio.js", () => ({
    startSharedStdio: async ({ control }: { control: ControlIdentity | Promise<ControlIdentity> }) => {
      controls.push(await control);
      return { close: async () => {} };
    }
  }));
  vi.stubEnv("SAY_UR_INTENT_DATA_DIR", directory);
  vi.stubEnv("SUI_GRPC_URL", undefined); vi.stubEnv("SUI_GRAPHQL_URL", undefined);
  try {
    for (const [index, project] of [undefined, "not-a-project-id", "1".repeat(32)].entries()) {
      vi.stubEnv("SAY_UR_INTENT_WALLETCONNECT_PROJECT_ID", project);
      vi.resetModules();
      await import("../src/runtime/start.js");
      await vi.waitFor(() => expect(controls).toHaveLength(index + 1));
      expect(process.listenerCount("SIGTERM")).toBe(processListeners.get("SIGTERM")!.size + index + 1);
    }
    const expected = fingerprint(JSON.stringify({ network: "mainnet", chainIdentifier: SUI_MAINNET_CHAIN_IDENTIFIER,
      walletConnectProjectId: WALLETCONNECT_PROJECT_ID, grpcOverride: null, graphqlOverride: null }));
    expect(fingerprint(WALLETCONNECT_PROJECT_ID)).toBe(approvedProjectFingerprint);
    expect(controls.map((control) => control.configurationId)).toEqual([expected, expected, expected]);
    expect(new Set(controls.map((control) => control.databaseId)).size).toBe(1);
    expect(new Set(controls.map((control) => control.key)).size).toBe(1);
    expect(source.init.mock.calls.length).toBe(0);
  } finally {
    for (const [event, before] of processListeners) {
      for (const listener of process.listeners(event)) if (!before.has(listener)) process.removeListener(event, listener);
    }
    for (const [event, before] of inputListeners) {
      for (const listener of process.stdin.listeners(event)) if (!before.has(listener)) process.stdin.removeListener(event, listener);
    }
    vi.doUnmock("../src/runtime/reviewServerAcquire.js"); vi.doUnmock("../src/runtime/shared/stdio.js"); vi.resetModules();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("accepts only backend initialization, restoration and state failures in the public reason contract", () => {
  expect(walletUnavailableReasonSchema.options).toEqual(["initialization_failed", "restoration_failed", "wallet_state_unavailable"]);
  for (const reason of ["configuration_missing", "configuration_invalid"]) {
    expect(walletUnavailableReasonSchema.safeParse(reason).success).toBe(false);
  }
});

it.each(["expired_pairing", "inactive_pairing"] as const)("keeps the real parent MCP usable during actual SDK %s cleanup without exposing the retired restart input", async (kind) => {
  const directory = mkdtempSync(join(tmpdir(), "say-runtime-sdk-held-")), relay = await walletRelay();
  source.realRelay = relay.url;
  await seedWalletSdk(directory, kind);
  const app = await createRuntimeApplication(loadBootConfig({ SAY_UR_INTENT_DATA_DIR: directory }), { info() {}, warn() {}, error() {} });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = {} as { result: CallToolResult };
    await app.handleMcp({ call: { name, arguments: args } } as unknown as IncomingMessage, response as unknown as ServerResponse);
    return response.result;
  };
  const payload = (result: CallToolResult) => {
    expect(result.isError).not.toBe(true);
    return (result.structuredContent as { data: Record<string, any> }).data;
  };
  try {
    // This request finishes while the real SDK's cleanup cannot finish.
    const interaction = payload(await call(TOOL_NAMES.sessionGetInteractionStatus));
    expect(interaction.walletAvailability.status).toBe("initializing");
    expect(interaction.assetReadAccount.status).toBe("address_required");
    await vi.waitFor(() => expect(relay.calls.some((request) => request.method === "irn_unsubscribe")).toBe(true), { timeout: 10000 });
    const created = await call(TOOL_NAMES.sessionCreateWalletConnection, { intent: "manage" });
    const reference = created._meta![CARD_METADATA_KEY] as Record<string, unknown>;
    const current = payload(await call(CARD_TOOLS.read, reference));
    expect(current.state).toBe("ready"); expect(current.data.allowedActions).not.toContain("restart_wallet_service");
    expect(() => acquireDataDirectoryOwner(join(directory, "activity.sqlite"))).toThrow("runtime owner");
    const priorRunId = current.data.walletAvailability.walletRunId;
    const refused = await call(CARD_TOOLS.act, { ...reference, revision: current.revision,
      input: { action: "restart_wallet_service", walletRunId: priorRunId } });
    expect(refused.isError).toBe(true);
    expect(source.children).toHaveLength(1); expect(source.children[0]!.exitCode).toBeNull();
    expect(source.commands).toEqual(["init"]);
    expect(() => acquireDataDirectoryOwner(join(directory, "activity.sqlite"))).toThrow("runtime owner");
    expect(payload(await call(TOOL_NAMES.accountGetActiveAccount))).toBeDefined();
  } finally {
    await app.close(); await relay.close(); rmSync(directory, { recursive: true, force: true });
  }
}, 25000);
