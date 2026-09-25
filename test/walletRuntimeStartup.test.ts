import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
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
  { failure: "missing", project: undefined, initCalls: 0, message: "configuration is required" },
  { failure: "invalid", project: "not-a-project-id", initCalls: 0, message: "configuration is invalid" },
  { failure: "metadata", project: "1".repeat(32), initCalls: 0, message: "could not be initialized" },
  { failure: "storage", project: "1".repeat(32), initCalls: 0, message: "could not be initialized" },
  { failure: "init", project: "1".repeat(32), initCalls: 1, message: "could not be initialized" },
  { failure: "restore", project: "1".repeat(32), initCalls: 1, message: "could not be restored" },
  { failure: "none", project: "1".repeat(32), initCalls: 1, message: undefined }
])("preserves $failure startup semantics through the real runtime and MCP cards", async ({ failure, project, initCalls, message }) => {
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
    if (message) expect(JSON.stringify(created)).toContain(message);
    expect(created.isError).not.toBe(true);
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
    expect((receipt.structuredContent as { data: { state: string } }).data.state).toBe("ready");
    expect(source.connect).not.toHaveBeenCalled(); expect(source.request).not.toHaveBeenCalled();
    expect(JSON.stringify([created, logger.error.mock.calls])).not.toContain("PRIVATE-");
    if (project) expect(JSON.stringify([created, logger.error.mock.calls])).not.toContain(project);
  } finally {
    await app.close();
    expect(source.leases.at(-1)).toHaveBeenCalledTimes(initCalls ? 0 : 1);
    for (const close of source.storage.splice(0)) close();
    for (const close of source.leases.splice(0)) close();
    rmSync(directory, { recursive: true, force: true });
  }
});
