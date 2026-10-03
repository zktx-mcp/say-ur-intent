import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { activeAccountResponse, activeAccountResponseSchema } from "../../activeAccountResponse.js";
import { registerSuiMcpTool } from "../../registerTool.js";
import { okToolResult } from "../../result.js";
import { noParamsInputSchema, successOutputSchema } from "../../schemas.js";
import type { McpServerDeps } from "../../server.js";
import { activityStoreToolError } from "../../toolErrors.js";
import { TOOL_NAMES } from "../../toolNames.js";

export function registerAccountTools(server: McpServer, deps: McpServerDeps): void {
  server.registerTool(
    TOOL_NAMES.accountGetActiveAccount,
    {
      title: "Get active account read context",
      description: "Return the active account address for wallet-account reads. Read context only; not signing authorization.",
      inputSchema: noParamsInputSchema,
      outputSchema: {
        ok: z.literal(true),
        data: activeAccountResponseSchema
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () => {
      try {
        const active = await deps.activityStore.getActiveAccount();
        return okToolResult(activeAccountResponse(active));
      } catch (error) {
        return activityStoreToolError(error, deps.logger);
      }
    }
  );

  registerSuiMcpTool(
    server,
    TOOL_NAMES.accountClearActiveAccount,
    {
      title: "Clear active account read context",
      description: "Remove the active read context. Does not disconnect a wallet or revoke onchain permission.",
      inputSchema: noParamsInputSchema,
      outputSchema: successOutputSchema({
        status: z.literal("cleared")
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async () => {
      try {
        await deps.activityStore.clearActiveAccount();
        return okToolResult({ status: "cleared" });
      } catch (error) {
        return activityStoreToolError(error, deps.logger);
      }
    }
  );
}
