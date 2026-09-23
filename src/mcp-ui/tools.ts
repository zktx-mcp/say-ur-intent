import { accountInputSchema, receiptInputSchema, chartOpenInputSchema } from "../core/read/readCardInputs.js";
import { readFile } from "node:fs/promises";
import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE, type McpUiAppToolConfig } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { McpServerDeps } from "../mcp/server.js";
import { okToolResult, errorToolResult } from "../mcp/result.js";
import { CardError } from "../core/session/cardSessionStore.js";
import type { CardResponse } from "../core/session/cardSession.js";
import { CARD_METADATA_KEY, CARD_DISPLAY_METADATA_KEY, CARD_RESOURCE_PREFIX, CARD_RESOURCE_URIS, CARD_TOOLS,
  cardReceiptDisplaySchema, cardReferenceSchema,
  cardSubmissionSchema } from "./contracts.js";

const metadata = (kind: keyof typeof CARD_RESOURCE_URIS): McpUiAppToolConfig["_meta"] => ({
  ui: { resourceUri: CARD_RESOURCE_URIS[kind], visibility: ["model"] },
  "openai/outputTemplate": CARD_RESOURCE_URIS[kind]
});
const uiResourceMetadata = { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: ["https:"], frameDomains: [], baseUriDomains: [] } } };

function supportsCards(server: McpServer): boolean {
  const capabilities = server.server.getClientCapabilities();
  const { extensions, ...standard } = capabilities ?? {};
  const current = capabilities === undefined ? undefined : { ...standard, ...(extensions === undefined ? {} : { extensions }) };
  return getUiCapability(current)?.mimeTypes?.includes(RESOURCE_MIME_TYPE) === true ||
    server.server.getClientVersion()?.name === "codex-mcp-client";
}
function cardToolResult(response: CardResponse, savedLink = false): CallToolResult {
  const result = response.error
    ? errorToolResult({ kind: "input_invalid", details: { code: response.error.code,
        reason: response.error.message, snapshot: response.snapshot } })
    : okToolResult(response.snapshot);
  if (savedLink) result.content.push({ type: "resource_link", name: `card_${response.snapshot.cardId}`,
    uri: `${CARD_RESOURCE_PREFIX}${response.snapshot.cardId}`, mimeType: "application/json", description: "Saved data for this exact card." });
  if (response.receiptDisplay) result._meta = { [CARD_DISPLAY_METADATA_KEY]: cardReceiptDisplaySchema.parse({
    ...response.receiptDisplay, cardId: response.snapshot.cardId, revision: response.snapshot.revision
  }) };
  return result;
}

export function registerReadCards(server: McpServer, deps: Pick<McpServerDeps, "cards" | "activityStore">): void {
  for (const [kind, uri] of Object.entries(CARD_RESOURCE_URIS)) {
    registerAppResource(server, `${kind}-card`, uri, { _meta: uiResourceMetadata }, async () => ({
      contents: [{ uri, mimeType: RESOURCE_MIME_TYPE,
        text: await readFile(new URL(`../../dist/mcp-app/${kind}.html`, import.meta.url), "utf8"), _meta: uiResourceMetadata }]
    }));
  }
  server.registerResource("saved-card", new ResourceTemplate(`${CARD_RESOURCE_PREFIX}{cardId}`, { list: undefined }),
    { mimeType: "application/json", description: "Saved data for one card; no input permission." }, async (uri, variables) => {
      if (!deps.cards || typeof variables.cardId !== "string") throw new CardError("Saved card data is unavailable.");
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(deps.cards.store.readSaved(variables.cardId)) }] };
    });
  async function create(kind: "account" | "receipt" | "chart", input: Record<string, unknown>): Promise<CallToolResult> {
    if (!supportsCards(server)) return errorToolResult({ kind: "ui_unavailable", details: { reason: "This MCP client does not provide an internal card." } });
    if (!deps.cards) return errorToolResult({ kind: "internal_error", details: { reason: "Card service unavailable." } });
    let execute = Object.keys(input).length > 0;
    if (kind === "account" && input.account === undefined) {
      const active = await deps.activityStore.getActiveAccount();
      if (active) { input = { account: active.address }; execute = true; }
    }
    if (kind === "chart" && input.poolName === undefined) execute = false;
    const created = await deps.cards.store.create(kind, input, execute);
    const result = cardToolResult(created, true);
    return { ...result, _meta: { ...result._meta, [CARD_METADATA_KEY]: { cardId: created.snapshot.cardId, permission: created.permission } } };
  }
  registerAppTool(server, CARD_TOOLS.account, { title: "Account assets", description: "Open an account asset card.",
    inputSchema: accountInputSchema.partial(), annotations: { readOnlyHint: true, openWorldHint: true }, _meta: metadata("account")
  }, (input) => create("account", input));
  registerAppTool(server, CARD_TOOLS.receipt, { title: "Transaction result", description: "Open a Sui transaction result card.",
    inputSchema: receiptInputSchema.partial(), annotations: { readOnlyHint: true, openWorldHint: true }, _meta: metadata("receipt")
  }, (input) => create("receipt", input));
  registerAppTool(server, CARD_TOOLS.chart, { title: "Market chart", description: "Open a DeepBook USDC candle chart card.",
    inputSchema: chartOpenInputSchema, annotations: { readOnlyHint: true, openWorldHint: true }, _meta: metadata("chart")
  }, (input) => create("chart", input));

  const actions = [
    { name: CARD_TOOLS.read, schema: cardReferenceSchema, run: (input: unknown) => deps.cards!.store.read(cardReferenceSchema.parse(input)) },
    { name: CARD_TOOLS.submit, schema: cardSubmissionSchema, run: (input: unknown) => deps.cards!.store.submit(cardSubmissionSchema.parse(input)) }
  ];
  for (const action of actions) {
    registerAppTool(server, action.name, { description: "Use the current card session.", inputSchema: action.schema,
      _meta: { ui: { visibility: ["app"] } }, annotations: { readOnlyHint: action.name === CARD_TOOLS.read, openWorldHint: false }
    }, async (input: unknown) => {
      try {
        if (!deps.cards) throw new CardError("Card service is unavailable.");
        return cardToolResult(await action.run(input));
      } catch (error) {
        return errorToolResult({ kind: "input_invalid", details: { code: error instanceof z.ZodError ? "invalid_card_input" : "card_unavailable", reason: error instanceof CardError ? error.message : error instanceof z.ZodError ? "Invalid card input." : "Card operation unavailable." } });
      }
    });
  }
}
