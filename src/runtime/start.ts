#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadBootConfig } from "./config.js";
import { createRuntimeApplication } from "./application.js";
import { createStderrLogger } from "./logger.js";
import { startOrDeferReviewServer, type ReviewServerLifecycle } from "./reviewServerAcquire.js";
import { loadControlIdentity } from "./shared/control.js";
import { probeAuthenticatedServer } from "./shared/authenticatedFetch.js";
import { startSharedServer } from "./shared/server.js";
import { startSharedStdio } from "./shared/stdio.js";

async function main(): Promise<void> {
  const logger = createStderrLogger("runtime");
  const bootConfig = loadBootConfig();
  const control = await loadControlIdentity(bootConfig.activityDatabasePath, {
    network: bootConfig.network, chainIdentifier: bootConfig.expectedChainIdentifier,
    walletConnectProjectId: process.env.SAY_UR_INTENT_WALLETCONNECT_PROJECT_ID ?? null,
    grpcOverride: process.env.SUI_GRPC_URL ?? null, graphqlOverride: process.env.SUI_GRAPHQL_URL ?? null
  });
  let shared: ReviewServerLifecycle | undefined;
  let bridge: Awaited<ReturnType<typeof startSharedStdio>> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try { await bridge?.close(); } finally { await shared?.close(); }
  })();
  try {
    shared = await startOrDeferReviewServer((port) => startSharedServer({
      port, control,
      createApplication: (instanceId) => createRuntimeApplication(bootConfig, logger, instanceId),
      onError: (error) => logger.error("shared server request failed", { error: error instanceof Error ? error.message : "unknown error" })
    }), bootConfig.reviewPort, {
      probeIdentity: async (port) => {
        try { return await probeAuthenticatedServer(port, control); } catch { return null; }
      },
      delay: (ms) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref(); }),
      currentPid: process.pid, serviceName: "say-ur-intent", logger,
      onFailure: (error) => { logger.error("shared server acquisition failed", { error: error.message }); void close().finally(() => process.exit(1)); }
    });
    const stdio = new StdioServerTransport();
    bridge = await startSharedStdio({ stdio, port: bootConfig.reviewPort, control,
      onError: (error) => logger.error("MCP transport failed", { error: error.message }) });
    const closeForClient = () => { void close().catch(() => logger.error("shutdown failed", { stage: "runtime_close" })).finally(() => process.exit(0)); };
    const protocolClosed = stdio.onclose;
    stdio.onclose = () => { protocolClosed?.(); closeForClient(); };
    process.stdin.once("end", closeForClient);
    process.stdin.once("close", closeForClient);
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => { void close().finally(() => process.exit(signal === "SIGINT" ? 130 : 143)); });
    }
  } catch (error) { await close(); throw error; }
}
main().catch((error: unknown) => {
  createStderrLogger("runtime").error("fatal runtime error", { error: error instanceof Error ? error.message : "Runtime startup failed." });
  process.exit(1);
});
