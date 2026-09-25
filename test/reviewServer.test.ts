import { SqliteActivityStore } from "../src/core/activity/sqliteActivityStore.js";
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionPlan } from "../src/core/action/types.js";
import { validateSupportedAdapterLifecycle } from "../src/adapters/adapterLifecycleValidators.js";
import { InMemorySessionStore, LocalSessionStore, type InMemorySessionStoreOptions } from "../src/core/session/sessionStore.js";
import { createReviewHttpServer } from "../src/review-server/server.js";
import type { Logger } from "../src/runtime/logger.js";
import { InMemoryActivityStore } from "./fixtures/inMemoryActivityStore.js";
import { InMemoryLocalSettingsService, InMemoryPreferencesRepository } from "./fixtures/inMemoryLocalSettings.js";
import { DEFAULT_SUI_GRAPHQL_URL, DEFAULT_SUI_GRPC_URL } from "../src/runtime/config.js";


const logger: Logger = {
  info() {},
  warn() {},
  error() {}
};

const plan: ActionPlan = {
  id: "plan_1",
  actionKind: "swap",
  adapterId: "deepbook-swap",
  protocol: "DeepBookV3",
  title: "Review swap",
  summary: "Review a swap",
  assetFlowPreview: {
    outgoing: [{ symbol: "SUI", amount: "1", amountKind: "display_intent" }],
    expectedIncoming: [{ symbol: "USDC", amount: "unknown", amountKind: "display_intent", approx: true }]
  },
  adapterData: {},
  createdAt: new Date(0).toISOString()
};

const walletAccount = `0x${"a".repeat(64)}`;

function createSessionStore(options: Partial<InMemorySessionStoreOptions> = {}): InMemorySessionStore {
  return new InMemorySessionStore({
    ...options,
    activityStore: options.activityStore ?? new InMemoryActivityStore(),
    logger: options.logger ?? logger,
    validateAdapterLifecycle: options.validateAdapterLifecycle ?? validateSupportedAdapterLifecycle
  });
}

async function createDefaultLocalSettings(): Promise<InMemoryLocalSettingsService> {
  const repository = new InMemoryPreferencesRepository();
  await repository.ensureDefaultLocalSettings({
    suiGrpcUrl: DEFAULT_SUI_GRPC_URL,
    suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL
  });
  return new InMemoryLocalSettingsService(repository);
}

async function createSettingsServer(options: { localSettings?: InMemoryLocalSettingsService } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "say-settings-atomic-"));
  const activityStore = new SqliteActivityStore({ databasePath: join(directory, "state.sqlite"), validateAdapterLifecycle: validateSupportedAdapterLifecycle });
  await activityStore.createPreferencesRepository().ensureDefaultLocalSettings({ suiGrpcUrl: DEFAULT_SUI_GRPC_URL, suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL });
  const store = new LocalSessionStore({ activityStore, logger, validateAdapterLifecycle: validateSupportedAdapterLifecycle, sessions: activityStore.createSessionRecordStore(), artifacts: activityStore.createPrivateReviewArtifactStore(),
    settingsStore: activityStore.createSettingsRecordStore() });
  const localSettings = options.localSettings ?? await createDefaultLocalSettings();
  const localData = activityStore.createLocalDataService({ suiGrpcUrl: DEFAULT_SUI_GRPC_URL, suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL,
    advanceRequestDeadlines: (now) => activityStore.createWalletWorkflowStore("settings-fixture").advanceRequestDeadlines(now),
    verifySuiGrpcUrl: async () => {}, verifySuiGraphqlUrl: async () => {} });
  const created = await store.createSettingsSession();
  const server = await createReviewHttpServer({
    host: "127.0.0.1",
    store,
    logger,
    activityStore,
    localSettings,
    localData,
    serverInfo: { name: "say-ur-intent", version: "0.0.0-test", network: "mainnet" }
  }).start(0);
  const close = server.close;
  server.close = async () => { try { await close(); } finally { activityStore.close(); rmSync(directory, { recursive: true, force: true }); } };
  return { server, store, activityStore, localSettings, created };
}

describe("remaining backend HTTP and retired routes", () => {
it("serves local settings status and no longer exposes a settings wallet-identity endpoint", async () => {
    const { server, created } = await createSettingsServer();
    try {
      const base = `http://${server.host}:${server.port}`;
      const status = await fetch(`${base}/api/settings/${created.session.id}`, {
        headers: { "x-say-ur-intent-token": created.token, origin: base }
      });
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({
        server: { name: "say-ur-intent", network: "mainnet" },
        localSettings: {
          suiGrpcUrl: {
            storedValue: DEFAULT_SUI_GRPC_URL,
            effectiveValue: DEFAULT_SUI_GRPC_URL
          },
          suiGraphqlUrl: {
            storedValue: DEFAULT_SUI_GRAPHQL_URL,
            effectiveValue: DEFAULT_SUI_GRAPHQL_URL
          }
        },
        dataCounts: { localSettings: 2 }
      });

      // Settings has no second account-binding path.
      const wallet = await fetch(`${base}/api/settings/${created.session.id}/wallet-identity`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: "{}"
      });
      expect(wallet.status).toBe(404);
    } finally {
      await server.close();
    }
  });

it("updates and restores the GraphQL endpoint through settings APIs", async () => {
    const { server, created } = await createSettingsServer();
    try {
      const base = `http://${server.host}:${server.port}`;
      const save = await fetch(`${base}/api/settings/${created.session.id}/sui-graphql-url`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: JSON.stringify({ url: "https://example.graphql.provider/graphql" })
      });
      expect(save.status).toBe(200);
      await expect(save.json()).resolves.toMatchObject({
        status: "saved",
        storedValue: "https://example.graphql.provider/graphql",
        appliesAfter: "mcp_server_restart"
      });

      const status = await fetch(`${base}/api/settings/${created.session.id}`, {
        headers: { "x-say-ur-intent-token": created.token, origin: base }
      });
      expect(status.status).toBe(200);
      await expect(status.json()).resolves.toMatchObject({
        localSettings: {
          suiGraphqlUrl: {
            storedValue: "https://example.graphql.provider/graphql",
            effectiveValue: DEFAULT_SUI_GRAPHQL_URL,
            pendingStoredValue: "https://example.graphql.provider/graphql",
            appliesAfter: "mcp_server_restart"
          }
        },
        restartRequired: true
      });

      const missingUrl = await fetch(`${base}/api/settings/${created.session.id}/sui-graphql-url`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: "{}"
      });
      expect(missingUrl.status).toBe(400);
      await expect(missingUrl.json()).resolves.toMatchObject({ error: "input_invalid" });

      const invalidUrl = await fetch(`${base}/api/settings/${created.session.id}/sui-graphql-url`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: JSON.stringify({ url: "http://example.graphql.provider/graphql" })
      });
      expect(invalidUrl.status).toBe(400);
      await expect(invalidUrl.json()).resolves.toMatchObject({ error: "input_invalid" });

      const restore = await fetch(`${base}/api/settings/${created.session.id}/sui-graphql-url/restore-default`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: "{}"
      });
      expect(restore.status).toBe(200);
      await expect(restore.json()).resolves.toMatchObject({
        status: "reset",
        storedValue: DEFAULT_SUI_GRAPHQL_URL,
        appliesAfter: "mcp_server_restart"
      });
    } finally {
      await server.close();
    }
  });

it("maps GraphQL endpoint validation errors through settings APIs", async () => {
    const repository = new InMemoryPreferencesRepository();
    await repository.ensureDefaultLocalSettings({
      suiGrpcUrl: DEFAULT_SUI_GRPC_URL,
      suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL
    });
    const localSettings = new InMemoryLocalSettingsService(repository, {
      verifyGraphqlEndpoint: async () => {
        throw new Error("provider unavailable");
      }
    });
    const { server, created } = await createSettingsServer({ localSettings });
    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/settings/${created.session.id}/sui-graphql-url`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: JSON.stringify({ url: "https://example.graphql.provider/graphql" })
      });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({ error: "internal_error" });
    } finally {
      await server.close();
    }
  });

it("validates settings API token before parsing request bodies", async () => {
    const { server, created } = await createSettingsServer();
    try {
      const base = `http://${server.host}:${server.port}`;
      const badOrigin = await fetch(`${base}/api/settings/${created.session.id}`, {
        headers: {
          "x-say-ur-intent-token": created.token,
          origin: "http://evil.example"
        }
      });
      expect(badOrigin.status).toBe(403);

      const response = await fetch(`${base}/api/settings/${created.session.id}/local-data/import/preview`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": "wrong",
          origin: base
        },
        body: "{"
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: "invalid_settings_token" });

      const queryToken = await fetch(`${base}/api/settings/${created.session.id}/local-data/import/preview?token=${created.token}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: "{}"
      });
      expect(queryToken.status).toBe(400);
      expect(await queryToken.json()).toMatchObject({ error: "token_query_not_supported" });

      const oversizedSettingsBody = await fetch(`${base}/api/settings/${created.session.id}/clear-active-account`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": created.token,
          origin: base
        },
        body: JSON.stringify({ padding: "x".repeat(64 * 1024) })
      });
      expect(oversizedSettingsBody.status).toBe(413);
      expect(await oversizedSettingsBody.json()).toMatchObject({ error: "payload_too_large" });
    } finally {
      await server.close();
    }
  });

it("enforces the local data import body limit", async () => {
    const { server, created } = await createSettingsServer();
    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/settings/${created.session.id}/local-data/import/preview`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": created.token,
          origin: base
        },
        body: JSON.stringify({ padding: "x".repeat(16 * 1024 * 1024) })
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: "payload_too_large" });
    } finally {
      await server.close();
    }
  });

it("invalidates local sessions after reset through settings APIs", async () => {
    const { server, created, store } = await createSettingsServer();
    const review = await store.createReviewSession([plan]);
    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/settings/${created.session.id}/local-data/reset`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": created.token,
          origin: base
        },
        body: "{}"
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "reset", sessionsInvalidated: true });
      await expect(store.getReviewSession(review.session.id)).resolves.toBeUndefined();
      await expect(store.getSettingsSession(created.session.id)).resolves.toBeUndefined();
      const afterReset = await store.createSettingsSession();
      expect(afterReset.session.id).not.toBe(created.session.id);
    } finally {
      await server.close();
    }
  });

it("rejects query tokens before routing, including retired paths", async () => {
    const store = createSessionStore();
    const server = await createReviewHttpServer({ host: "127.0.0.1", store, logger }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      // The global guard runs before route lookup. Retired paths must not
      // bypass the prohibition on tokens in query parameters.
      const publicReadEndpoints = [
        `/api/account/assets?address=${walletAccount}&token=secret`,
        `/api/receipt?digest=anything&token=secret`,
        `/api/charts/deepbook-usdc/pools?token=secret`,
        `/api/charts/deepbook-usdc/candles?token=secret`
      ];
      for (const endpoint of publicReadEndpoints) {
        const res = await fetch(`${base}${endpoint}`);
        expect(res.status, endpoint).toBe(400);
        expect(await res.json(), endpoint).toMatchObject({ error: "token_query_not_supported" });
      }
    } finally {
      await server.close();
    }
  });

it("returns JSON not-found for replaced pages, read APIs and the unsigned identity probe", async () => {
    const server = await createReviewHttpServer({ host: "127.0.0.1", store: createSessionStore(), logger }).start(0);
    try {
      for (const path of ["/review/old", "/connect/old", "/api/review/old", "/api/review/old/handoff", "/api/review/old/result", "/api/wallet/old/result", "/", "/account", "/receipt", "/charts/deepbook-usdc", "/api/account/assets", "/api/account/active-account", "/api/charts/deepbook-usdc/pools", "/api/charts/deepbook-usdc/candles", "/__identity", "/no-such-page"]) {
        const result = await fetch("http://127.0.0.1:" + server.port + path, { headers: { accept: "text/html" } });
        expect(result.status, path).toBe(404);
        expect(result.headers.get("content-type"), path).toContain("application/json");
        expect(await result.json(), path).toEqual({ error: "not_found" });
      }
    } finally { await server.close(); }
  });
});
