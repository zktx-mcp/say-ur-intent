import {
  ReadServiceCacheError,
  ReadServiceInputError
} from "../../../core/read/readService.js";
import { parseSuiAddress } from "../../../core/suiAddress.js";
import { errorToolResult } from "../../result.js";
import { activityStoreToolError } from "../../toolErrors.js";
import type { McpServerDeps } from "../../server.js";

export async function resolveExplicitOrActiveAccount(
  account: string | undefined,
  deps: McpServerDeps
): Promise<
  | { status: "ok"; account: string }
  | { status: "error"; result: ReturnType<typeof errorToolResult> }
> {
  if (account !== undefined) {
    const explicitAccount = parseSuiAddress(account);
    if (explicitAccount === undefined) {
      return {
        status: "error",
        result: errorToolResult({
          kind: "input_invalid",
          details: {
            field: "account"
          }
        })
      };
    }
    return { status: "ok", account: explicitAccount };
  }

  let active;
  try {
    active = await deps.activityStore.getActiveAccount();
  } catch (error) {
    return { status: "error", result: activityStoreToolError(error, deps.logger) };
  }
  if (!active) {
    return {
      status: "error",
      result: errorToolResult({
        kind: "active_account_not_set",
        details: {
          action: "connect_wallet_connection"
        }
      })
    };
  }
  return { status: "ok", account: active.address };
}

export function readServiceError(error: unknown, deps: McpServerDeps) {
  if (error instanceof ReadServiceCacheError) {
    deps.logger.error("read service metadata cache failed", {
      operation: error.details.operation,
      error: error.cause instanceof Error ? error.cause.message : String(error.cause)
    });
    return errorToolResult({
      kind: error.kind,
      details: error.details
    });
  }

  if (error instanceof ReadServiceInputError) {
    return errorToolResult({
      kind: error.kind,
      details: error.details
    });
  }

  deps.logger.error("read service call failed", {
    error: error instanceof Error ? error.message : String(error)
  });

  return errorToolResult({
    kind: "internal_error",
    details: { message: "Read service call failed" }
  });
}

export function activityStoreReadError(error: unknown, deps: McpServerDeps) {
  return activityStoreToolError(error, deps.logger);
}
