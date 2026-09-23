import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { describe, expect, it } from "vitest";
import { registerReadCards } from "../src/mcp-ui/tools.js";
import { createReadCardStore } from "../src/mcp-ui/readCards.js";
import { createDeepbookUsdcChartService } from "../src/core/read/deepbookUsdcChartService.js";
import { SqliteActivityStore } from "../src/core/activity/sqliteActivityStore.js";
import { validateSupportedAdapterLifecycle } from "../src/adapters/adapterLifecycleValidators.js";
import { CARD_METADATA_KEY, CARD_DISPLAY_METADATA_KEY, CARD_TOOLS, CARD_RESOURCE_PREFIX,
  cardReferenceSchema, cardSnapshotSchema, cardReceiptDisplaySchema } from "../src/mcp-ui/contracts.js";
import { chainReceiptDigest, otherChainReceiptDigest } from "./fixtures/chainReceipt.js";
import { cardReceiptTransaction } from "./fixtures/cardReceiptTransaction.js";
import { readPublicChainReceipt } from "../src/core/action/suiChainReceiptReader.js";
import type { AccountInventorySummary } from "../src/core/read/readServiceTypes.js";
import { receiptForCard } from "../src/mcp-ui/view/receiptData.js";
import { receiptToMarkdown } from "../review-app/src/receiptMarkdown.js";

const account = `0x${"a".repeat(64)}`;
const fetchedAt = "2026-09-22T00:00:00.000Z";
const inventory: AccountInventorySummary = { status: "ok", account, fetchedAt, name: null, balances: [], nfts: [], objectGroups: [], scannedObjects: 0, objectsTruncated: false };
async function harness(ui: boolean, transaction = cardReceiptTransaction) {
  const directory = mkdtempSync(join(tmpdir(), "say-card-mcp-"));
  const activityStore = new SqliteActivityStore({ databasePath: join(directory, "state.sqlite"), validateAdapterLifecycle: validateSupportedAdapterLifecycle });
  const accountInputs: unknown[] = []; const receiptInputs: unknown[] = [];
  const chart = createDeepbookUsdcChartService();
  const cards = createReadCardStore({ chart, records: activityStore.createCardRecordStore(), ownerId: "owner", now: () => new Date(fetchedAt),
    readService: { summarizeAccountInventory: async (input) => { accountInputs.push(input); return inventory; } },
    publicChainReceiptReader: async (input) => {
      receiptInputs.push(input);
      if (input.digest === otherChainReceiptDigest) return { status: "not_found" };
      return readPublicChainReceipt({ network: "mainnet", expectedChainIdentifier: "mainnet-chain", client: { core: {
        async getChainIdentifier() { return { chainIdentifier: "mainnet-chain" }; },
        async getTransaction(options) { expect(options.digest).toBe(chainReceiptDigest); return { $kind: "Transaction", Transaction: transaction }; }
      } } }, input);
    }
  });
  const server = new McpServer({ name: "card-service-fixture", version: "1" });
  registerReadCards(server, { cards: { store: cards }, activityStore });
  const client = new Client({ name: "card-test-client", version: "1" }, { capabilities: ui ? { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } : {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, accountInputs, receiptInputs, close: async () => {
    await client.close(); await server.close(); cards.stop(); activityStore.close(); rmSync(directory, { recursive: true, force: true });
  } };
}
function snapshot(result: Awaited<ReturnType<Client["callTool"]>>) {
  const payload = result.structuredContent as { ok: boolean; data: unknown };
  expect(payload.ok).toBe(true); return cardSnapshotSchema.parse(payload.data);
}

describe("MCP read cards, persisted results and private display", () => {
  it("exposes only current app-only read/submit controls, without temporary diagnostic or opening tools", async () => {
    const context = await harness(true);
    try {
      const tools = (await context.client.listTools()).tools;
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([CARD_TOOLS.read, CARD_TOOLS.submit]));
      expect(tools.find((tool) => tool.name === CARD_TOOLS.submit)?._meta).toMatchObject({ ui: { visibility: ["app"] } });
      for (const old of ["ui.open_card", "ui.close_card", "ui.record_card_diagnostics"]) expect(tools.some((tool) => tool.name === old)).toBe(false);
    } finally { await context.close(); }
  });
  it("passes one account selection to the service and returns current state after conflicting input", async () => {
    const context = await harness(true);
    try {
      const creating = await context.client.callTool({ name: CARD_TOOLS.account, arguments: {} });
      const ready = snapshot(creating); expect(ready.state).toBe("ready");
      const ref = cardReferenceSchema.parse(creating._meta?.[CARD_METADATA_KEY]);
      expect(JSON.stringify({ content: creating.content, structuredContent: creating.structuredContent })).not.toContain(ref.permission);
      const saved = await context.client.readResource({ uri: `${CARD_RESOURCE_PREFIX}${ready.cardId}` });
      expect(JSON.stringify(saved)).not.toContain(ref.permission);
      for (let frame = 0; frame < 2; frame++) {
        expect(snapshot(await context.client.callTool({ name: CARD_TOOLS.read, arguments: ref }))).toMatchObject({ state: "ready", revision: 0 });
      }
      const submitted = await context.client.callTool({ name: CARD_TOOLS.submit, arguments: { ...ref, revision: 0, input: { account } } });
      expect(snapshot(submitted)).toMatchObject({ state: "closed", reason: "completed", data: inventory });
      const conflicting = await context.client.callTool({ name: CARD_TOOLS.submit, arguments: { ...ref, revision: 0, input: { account: `0x${"b".repeat(64)}` } } });
      expect(conflicting.isError).toBe(true);
      expect(JSON.parse((conflicting.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ error: { details: {
        code: "card_conflict", snapshot: { state: "closed", data: inventory }
      } } });
      const denied = await context.client.callTool({ name: CARD_TOOLS.submit, arguments: { ...ref, permission: "wrong", revision: 0, input: { account } } });
      expect(denied.isError).toBe(true); expect(denied._meta).toBeUndefined();
      expect(JSON.stringify(denied)).not.toContain('"snapshot"'); expect(context.accountInputs).toEqual([{ account }]);
    } finally { await context.close(); }
  });
  it.each(["initial", "form"])("delivers real reader Pure inputs and PTB privately through the %s path", async (entry) => {
    const context = await harness(true);
    try {
      const creating = await context.client.callTool({ name: CARD_TOOLS.receipt, arguments: entry === "initial" ? { digest: chainReceiptDigest } : {} });
      const ref = cardReferenceSchema.parse(creating._meta?.[CARD_METADATA_KEY]);
      const response = entry === "initial" ? creating : await context.client.callTool({ name: CARD_TOOLS.submit,
        arguments: { ...ref, revision: 0, input: { digest: chainReceiptDigest } } });
      const result = snapshot(response);
      expect(result).toMatchObject({ state: "closed", reason: "completed", data: { status: "found", receipt: {
        txDigest: chainReceiptDigest, gas: { totalMist: "130" }, inputs: [{ index: 0, kind: "pure" }, { index: 1, kind: "pure" }]
      } } });
      const details = cardReceiptDisplaySchema.parse(response._meta?.[CARD_DISPLAY_METADATA_KEY]);
      expect(details.pureInputs).toEqual([{ index: 0, bytes: "0x00" }, { index: 1, bytes: "0x98c276f632000000" }]);
      expect(details.ptbGraph?.mermaid.text).toContain("flowchart LR");
      const receipt = receiptForCard(result, details);
      const markdown = receiptToMarkdown(receipt.txDigest, receipt);
      expect(markdown).toContain("0x00"); expect(markdown).toContain("0x98c276f632000000");
      expect(receipt.ptbGraph).toEqual(details.ptbGraph);
      const saved = await context.client.readResource({ uri: `${CARD_RESOURCE_PREFIX}${result.cardId}` });
      const model = JSON.stringify({ content: response.content, structuredContent: response.structuredContent, saved });
      for (const forbidden of [ref.permission, "0x98c276f632000000", "mMJ29jIAAAA=", "fixture-signature-never-exposed", '"bytes"', "flowchart LR"]) expect(model).not.toContain(forbidden);
      const read = await context.client.callTool({ name: CARD_TOOLS.read, arguments: ref });
      expect(read._meta?.[CARD_DISPLAY_METADATA_KEY]).toEqual(details);
      expect(context.receiptInputs).toHaveLength(1);
      for (const change of [{ cardId: "wrong" }, { revision: details.revision + 1 }, { transactionDigest: otherChainReceiptDigest }]) {
        expect(() => receiptForCard(result, { ...details, ...change })).toThrow("do not match");
      }
      expect(receiptForCard(result).inputs.every((input) => input.bytes === undefined)).toBe(true);
      const denied = await context.client.callTool({ name: CARD_TOOLS.read, arguments: { ...ref, permission: "wrong" } });
      expect(denied._meta).toBeUndefined(); expect(JSON.stringify(denied)).not.toContain("0x98c276f632000000");
    } finally { await context.close(); }
  });
  it("rejects a well-formed source receipt for a different digest before storing UI details", async () => {
    const context = await harness(true, { ...cardReceiptTransaction, digest: otherChainReceiptDigest,
      effects: { ...cardReceiptTransaction.effects, transactionDigest: otherChainReceiptDigest } });
    try {
      const response = await context.client.callTool({ name: CARD_TOOLS.receipt, arguments: { digest: chainReceiptDigest } });
      const state = snapshot(response);
      expect(state).toMatchObject({ state: "closed", reason: "failed", input: { digest: chainReceiptDigest } });
      expect(state.data).toBeUndefined();
      expect(response._meta?.[CARD_DISPLAY_METADATA_KEY]).toBeUndefined();
      const saved = await context.client.readResource({ uri: `${CARD_RESOURCE_PREFIX}${state.cardId}` });
      expect(JSON.stringify(saved)).not.toContain(otherChainReceiptDigest);
      expect(context.receiptInputs).toHaveLength(1);
    } finally { await context.close(); }
  });
  it("keeps not-found results distinct and rejects invalid digests before source access", async () => {
    const context = await harness(true);
    try {
      expect(snapshot(await context.client.callTool({ name: CARD_TOOLS.receipt, arguments: { digest: otherChainReceiptDigest } })).data).toEqual({ status: "not_found" });
      expect((await context.client.callTool({ name: CARD_TOOLS.receipt, arguments: { digest: "bad" } })).isError).toBe(true);
      expect(context.receiptInputs).toHaveLength(1);
    } finally { await context.close(); }
  });
  it("does not create UI permission or call the source for an ordinary MCP client", async () => {
    const context = await harness(false);
    try {
      const result = await context.client.callTool({ name: CARD_TOOLS.account, arguments: { account } });
      expect(result.isError).toBe(true); expect(result._meta).toBeUndefined();
      expect(JSON.stringify(result.content)).toContain("ui_unavailable"); expect(context.accountInputs).toEqual([]);
    } finally { await context.close(); }
  });
});
