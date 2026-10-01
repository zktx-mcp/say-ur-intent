import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// Fingerprint of the product owner's approved input, independent of the runtime constant.
const approvedProjectFingerprint = "0878d5895848f26e5631d667db9f5473ebaf875775af53f190467b50f810147d";
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

const source = vi.hoisted(() => ({ failure: "", init: vi.fn(), connect: vi.fn(), request: vi.fn(),
  storage: [] as Array<() => void>, leases: [] as Array<Mock<() => void>> }));
vi.mock("@walletconnect/sign-client", () => ({ SignClient: { init: source.init } }));
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
vi.mock("../src/runtime/walletConnectStorage.js", async (original) => {
  const actual = await original<typeof import("../src/runtime/walletConnectStorage.js")>();
  return { ...actual, openWalletConnectStorage: (directory: string) => {
    if (source.failure === "storage") throw new Error("PRIVATE-STORAGE-DETAIL");
    const owner = actual.openWalletConnectStorage(directory);
    source.storage.push(owner.closeBeforeSdkUse); return owner;
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
  source.init.mockImplementation(async () => {
    if (source.failure === "init") throw new Error("PRIVATE-SDK-DETAIL");
    return { connect: source.connect, request: source.request, on() {}, off() {},
      session: { getAll() { if (source.failure === "restore") throw new Error("PRIVATE-RESTORE-DETAIL"); return []; } },
      core: { pairing: { getPairings: () => [] } } };
  });
});
afterEach(() => {
  // The SDK itself is a double with no timers. This represents fixture process
  // exit, after asserting production did not release an active SDK owner's lock.
  for (const close of source.storage.splice(0)) close();
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
      expect(card.state).toBe(message ? "closed" : "ready");
      if (message) {
        expect(JSON.stringify(await call(TOOL_NAMES.sessionGetWalletConnection, { cardId: card.cardId }))).toContain(message);
        expect(JSON.stringify(await call(TOOL_NAMES.sessionWaitWalletConnection, { cardId: card.cardId, timeoutMs: 1 }))).toContain(message);
        const ref = created._meta![CARD_METADATA_KEY] as Record<string, unknown>;
        expect(JSON.stringify(await call(CARD_TOOLS.act, { ...ref, revision: card.revision, input: { action: "connect" } }))).toContain(message);
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
    expect(source.leases.at(-1)).toHaveBeenCalledTimes(initCalls ? 0 : 1);
    for (const close of source.storage.splice(0)) close();
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
    startSharedStdio: async ({ control }: { control: ControlIdentity }) => {
      controls.push(control);
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
      await vi.waitFor(() => expect(process.listenerCount("SIGTERM")).toBe(processListeners.get("SIGTERM")!.size + index + 1));
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
