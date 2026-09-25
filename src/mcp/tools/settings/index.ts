import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SETTINGS_APPLIES_AFTER_RESTART } from "../../../core/preferences/preferencesStore.js";
import { registerSayUrIntentTool } from "../../registerTool.js";
import { errorToolResult, okToolResult } from "../../result.js";
import { noParamsInputSchema, successOutputSchema } from "../../schemas.js";
import type { McpServerDeps } from "../../server.js";
import { localSettingsToolError, sessionStoreToolError } from "../../toolErrors.js";
import { TOOL_NAMES } from "../../toolNames.js";

const endpointSettingSchema = z.object({
  storedValue: z.string(),
  effectiveValue: z.string(),
  source: z.enum(["environment", "local_db", "builtin_default"]),
  pendingStoredValue: z.string().optional(),
  appliesAfter: z.literal(SETTINGS_APPLIES_AFTER_RESTART).optional()
});

export function registerSettingsTools(server: McpServer, deps: McpServerDeps): void {
  server.registerTool(
    TOOL_NAMES.settingsCreateLocalSettingsSession,
    {
      title: "Create local settings session",
      description: "Create a local settings page session.",
      inputSchema: noParamsInputSchema,
      outputSchema: successOutputSchema({
        settingsSessionId: z.string(),
        settingsUrl: z.string(),
        status: z.literal("created"),
        openTarget: z.literal("system_browser"),
        accessScope: z.literal("same_machine_loopback"),
        expiresAt: z.string(),
        lastActivityAt: z.string()
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async () => {
      try {
        if (!deps.reviewBaseUrl) return errorToolResult({ kind: "ui_unavailable", details: { reason: "Settings UI is unavailable in this runtime." } });
        const created = await deps.sessions.createSettingsSession();
        return okToolResult({
          settingsSessionId: created.session.id,
          settingsUrl: `${deps.reviewBaseUrl}/settings/${created.session.id}#${created.token}`,
          status: "created",
          openTarget: "system_browser",
          accessScope: "same_machine_loopback",
          expiresAt: created.session.expiresAt,
          lastActivityAt: created.session.lastActivityAt
        });
      } catch (error) {
        return sessionStoreToolError(error, deps.logger);
      }
    }
  );

  registerSayUrIntentTool(
    server,
    TOOL_NAMES.settingsGetLocalSettings,
    {
      title: "Get local settings",
      description: "Read local Say Ur Intent settings.",
      inputSchema: noParamsInputSchema,
      outputSchema: successOutputSchema({
        suiGrpcUrl: endpointSettingSchema,
        suiGraphqlUrl: endpointSettingSchema
      }),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () => {
      try {
        return okToolResult(await deps.localSettings.getLocalSettings());
      } catch (error) {
        return localSettingsToolError(error, deps.logger);
      }
    }
  );
}
