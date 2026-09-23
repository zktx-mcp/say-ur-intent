import { SqliteActivityStore } from "../src/core/activity/sqliteActivityStore.js";
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionPlan } from "../src/core/action/types.js";
import { validateSupportedAdapterLifecycle } from "../src/adapters/adapterLifecycleValidators.js";
import { buildSupportedReviewAdapters } from "../src/adapters/reviewAdapters.js";
import { InMemorySessionStore, LocalSessionStore, type InMemorySessionStoreOptions } from "../src/core/session/sessionStore.js";
import { InMemoryLocalTransactionMaterialStore } from "../src/core/session/transactionMaterialStore.js";
import { recordTestTransactionMaterial } from "./fixtures/transactionMaterial.js";
import { createReviewHttpServer } from "../src/review-server/server.js";
import type { Logger } from "../src/runtime/logger.js";
import { deepbookDisplayQuote } from "./fixtures/deepbookQuote.js";
import { InMemoryActivityStore } from "./fixtures/inMemoryActivityStore.js";
import { InMemoryLocalSettingsService, InMemoryPreferencesRepository } from "./fixtures/inMemoryLocalSettings.js";
import { DEFAULT_SUI_GRAPHQL_URL, DEFAULT_SUI_GRPC_URL } from "../src/runtime/config.js";
import {
  chainReceiptDigest,
  chainReceiptFixture,
  otherChainReceiptDigest
} from "./fixtures/chainReceipt.js";


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

async function openReview(store: InMemorySessionStore, sessionId: string, now = new Date()) {
  return store.recordReviewPageOpened(sessionId, now);
}

async function connectWalletIdentity(
  store: InMemorySessionStore,
  account = walletAccount,
  now = new Date()
) {
  const { session } = await store.createWalletIdentitySession(now);
  await store.recordWalletIdentityOpened(session.id, now);
  await store.recordWalletIdentityConnecting(session.id, now);
  return store.recordWalletIdentityResult(
    session.id,
    { status: "connected", account, chain: "sui:mainnet", walletName: "Test Wallet" },
    now
  );
}

async function openAndConnectReview(
  store: InMemorySessionStore,
  sessionId: string,
  account = walletAccount,
  now = new Date()
) {
  await connectWalletIdentity(store, account, now);
  await openReview(store, sessionId, now);
  return store.recordWalletConnected(sessionId, account, now);
}

function attachReviewedCommitment(
  store: InMemorySessionStore,
  sessionId: string,
  transactionMaterialCommitment = chainReceiptDigest
) {
  const recordStore = (store as unknown as {
    sessions: {
      get(id: string): unknown;
      commitReviewSessionTransition(id: string, expected: unknown, next: unknown): boolean;
    };
  }).sessions;
  const session = recordStore.get(sessionId) as {
    reviewState?: Record<string, unknown>;
  } | undefined;
  if (!session?.reviewState) {
    throw new Error("test setup requires review state");
  }
  const committed = recordStore.commitReviewSessionTransition(sessionId, session, {
    ...session,
    reviewState: {
      ...session.reviewState,
      walletReviewAdapterContract: { transactionMaterialCommitment }
    }
  });
  if (!committed) {
    throw new Error("test setup could not attach reviewed commitment");
  }
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
    walletIdentityStore: activityStore.createWalletIdentityRecordStore(), settingsStore: activityStore.createSettingsRecordStore() });
  const localSettings = options.localSettings ?? await createDefaultLocalSettings();
  const localData = activityStore.createLocalDataService({ suiGrpcUrl: DEFAULT_SUI_GRPC_URL, suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL,
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

describe("review HTTP server", () => {
  it("requires review token for state-changing endpoints", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const missingToken = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ planId: plan.id, account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
      });
      expect(missingToken.status).toBe(401);
      const bodyToken = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ planId: plan.id, account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", token })
      });
      expect(bodyToken.status).toBe(401);
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);

      const withToken = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, account: walletAccount.toUpperCase() })
      });
      expect(withToken.status).toBe(200);
      const json = (await withToken.json()) as { reviewState: { account: string; status: string; blockedReason: string } };
      expect(json.reviewState.account).toBe(walletAccount);
      expect(json.reviewState.status).toBe("blocked");
      expect(json.reviewState.blockedReason).toBe("adapter_not_implemented");

      const stored = await store.getReviewSession(session.id);
      expect(stored?.reviewState?.account).toBe(walletAccount);
    } finally {
      await server.close();
    }
  });

  it("returns DeepBook account-bound adapter lifecycle stages from review state computation", async () => {
    const store = createSessionStore();
    const deepbookPlan: ActionPlan = {
      ...plan,
      adapterData: {
        requestedIntent: {
          type: "swap",
          from: { symbol: "SUI", amountDisplay: "1" },
          to: { symbol: "USDC" },
          maxSlippageBps: 50
        }
      }
    };
    const { session, token } = await store.createReviewSession([deepbookPlan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      reviewComputationDeps: {
        validateAdapterLifecycle: validateSupportedAdapterLifecycle,
        adapters: buildSupportedReviewAdapters({ deepbook: {
          deepbookQuoteSource: {
            quoteDeepbookDisplayAmount: async () =>
              deepbookDisplayQuote({ fetchedAt: new Date(Date.now() - 1_000).toISOString() })
          }
        } })
      }
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);

      const response = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: deepbookPlan.id, account: walletAccount })
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        reviewState: {
          status: string;
          blockedReason: string;
          adapterLifecycle?: { stageCatalogId: string; completedStages: string[]; missingStages: string[] };
        };
      };
      expect(json.reviewState.status).toBe("blocked");
      expect(json.reviewState.blockedReason).toBe("producer_stage_missing");
      expect(json.reviewState.adapterLifecycle).toMatchObject({
        stageCatalogId: "deepbook_swap_review_v1",
        completedStages: [
          "intent_normalized",
          "pool_resolved",
          "quote_evidence_fetched",
          "quote_policy_derived"
        ],
        missingStages: expect.arrayContaining(["transaction_material_build_or_verify"])
      });
    } finally {
      await server.close();
    }
  });

  it("stores private DeepBook material artifacts without returning them from review state API", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const deepbookPlan: ActionPlan = {
      ...plan,
      adapterData: {
        requestedIntent: {
          type: "swap",
          from: { symbol: "SUI", amountDisplay: "1" },
          to: { symbol: "USDC" },
          maxSlippageBps: 50
        }
      }
    };
    const { session, token } = await store.createReviewSession([deepbookPlan]);
    let materialDigest: Awaited<ReturnType<typeof recordTestTransactionMaterial>>["digest"] | undefined;
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      reviewComputationDeps: {
        validateAdapterLifecycle: validateSupportedAdapterLifecycle,
        adapters: buildSupportedReviewAdapters({ deepbook: {
        deepbookQuoteSource: {
          quoteDeepbookDisplayAmount: async () =>
            deepbookDisplayQuote({ fetchedAt: new Date(Date.now() - 1_000).toISOString() })
        },
        deepbookTransactionMaterialProducer: async (input) => {
          const expiresAt = new Date(Date.parse(input.quotePolicy.fetchedAt) + input.quotePolicy.staleAfterMs);
          const material = await recordTestTransactionMaterial({
            materialStore,
            reviewSessionId: session.id,
            planId: input.plan.id,
            account: input.account,
            now: input.now,
            expiresAt
          });
          materialDigest = material.digest;
          return {
            status: "completed",
            evidence: material.handle,
            checks: [
              {
                id: "deepbook_transaction_material_build_or_verify",
                label: "Transaction material build or verify",
                status: "pass",
                message: "Local-only transaction material was produced for the review session.",
                source: "adapter"
              }
            ]
          };
        },
        deepbookTransactionMaterialDigestProducer: async () => {
          if (!materialDigest) {
            throw new Error("test material digest was not produced");
          }
          return {
            status: "completed",
            evidence: materialDigest,
            checks: [
              {
                id: "deepbook_transaction_material_digest_commitment",
                label: "Transaction material digest",
                status: "pass",
                message: "Digest commitment was derived from the stored material.",
                source: "adapter"
              }
            ]
          };
        }
        } })
      }
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);

      const response = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: deepbookPlan.id, account: walletAccount })
      });

      expect(response.status).toBe(200);
      const bodyText = await response.text();
      const json = JSON.parse(bodyText) as {
        reviewState: { adapterLifecycle?: { completedStages: string[] } };
      };
      if (!materialDigest) {
        throw new Error("test material digest was not produced");
      }
      expect(json.reviewState.adapterLifecycle?.completedStages).toEqual([
        "intent_normalized",
        "pool_resolved",
        "quote_evidence_fetched",
        "quote_policy_derived",
        "transaction_material_build_or_verify",
        "digest_commitment"
      ]);
      expect(bodyText).not.toContain("transactionBytes");
      expect(bodyText).not.toContain("txmat_");
      expect(bodyText).not.toContain(materialDigest.transactionDigest);
      expect(await store.getReviewSessionPrivateArtifacts(session.id)).toMatchObject({
        transactionMaterialDigest: {
          transactionDigest: materialDigest.transactionDigest
        }
      });
    } finally {
      await server.close();
    }
  });

  it("fails closed for malformed DeepBook plan identity during review state computation", async () => {
    const store = createSessionStore();
    const malformedDeepbookPlan: ActionPlan = {
      ...plan,
      protocol: "WrongProtocol",
      adapterData: {
        requestedIntent: {
          type: "swap",
          from: { symbol: "SUI", amountDisplay: "1" },
          to: { symbol: "USDC" },
          maxSlippageBps: 50
        }
      }
    };
    const { session, token } = await store.createReviewSession([malformedDeepbookPlan]);
    let quoteCalled = false;
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      reviewComputationDeps: {
        validateAdapterLifecycle: validateSupportedAdapterLifecycle,
        adapters: buildSupportedReviewAdapters({ deepbook: {
          deepbookQuoteSource: {
            quoteDeepbookDisplayAmount: async () => {
              quoteCalled = true;
              return deepbookDisplayQuote();
            }
          }
        } })
      }
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);

      const response = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: malformedDeepbookPlan.id, account: walletAccount })
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        reviewState: {
          status: string;
          blockedReason: string;
          adapterLifecycle?: unknown;
          checks: Array<{ id: string; status: string; source: string }>;
        };
      };
      expect(json.reviewState.status).toBe("blocked");
      expect(json.reviewState.blockedReason).toBe("unsupported_action");
      expect(json.reviewState.adapterLifecycle).toBeUndefined();
      expect(json.reviewState.checks).toContainEqual(expect.objectContaining({
        id: "deepbook_swap_plan_identity_invalid",
        status: "fail",
        source: "adapter"
      }));
      expect(quoteCalled).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("validates POST tokens before parsing request bodies", async () => {
    const store = createSessionStore();
    const { session: reviewSession } = await store.createReviewSession([plan]);
    const { session: walletSession } = await store.createWalletIdentitySession();
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const cases = [
        { path: `/api/review/${reviewSession.id}/opened`, error: "invalid_review_token" },
        { path: `/api/review/${reviewSession.id}/state`, error: "invalid_review_token" },
        { path: `/api/review/${reviewSession.id}/result`, error: "invalid_review_token" },
        { path: `/api/wallet/${walletSession.id}/opened`, error: "invalid_wallet_token" },
        { path: `/api/wallet/${walletSession.id}/connecting`, error: "invalid_wallet_token" },
        { path: `/api/wallet/${walletSession.id}/result`, error: "invalid_wallet_token" }
      ];

      for (const item of cases) {
        const response = await fetch(`${base}${item.path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-say-ur-intent-token": "wrong",
            origin: base
          },
          body: "{"
        });
        expect(response.status, item.path).toBe(401);
        await expect(response.json(), item.path).resolves.toMatchObject({ error: item.error });
      }
    } finally {
      await server.close();
    }
  });

  it("serves review HTML as a bundled review app shell", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const badOrigin = await fetch(`${base}/review/${session.id}`, {
        headers: { origin: "http://evil.example" }
      });
      expect(badOrigin.status).toBe(403);

      // The token rides in the URL fragment, never the query.
      const queryToken = await fetch(`${base}/review/${session.id}?token=secret`);
      expect(queryToken.status).toBe(400);
      expect(await queryToken.json()).toEqual({ error: "token_query_not_supported" });

      const response = await fetch(`${base}/review/${session.id}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(response.headers.get("content-security-policy")).toContain("style-src 'self' 'unsafe-inline'");
      expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
      const html = await response.text();
      expect(html).toContain("/review-assets/review.js");
      expect(html).toContain("/review-assets/review.css");
      expect(html).toContain(`data-review-session-id="${session.id}"`);
      expect(html).not.toContain("x-say-ur-intent-token");
      expect(html).not.toContain("console.log");
    } finally {
      await server.close();
    }
  });

  it("removes the per-session analysis and review wallet-identity routes", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const analysisPage = await fetch(`${base}/review/${session.id}/analysis`);
      expect(analysisPage.status).toBe(404);

      const analysisApi = await fetch(`${base}/api/review/${session.id}/analysis`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      expect(analysisApi.status).toBe(404);

      const walletIdentity = await fetch(`${base}/api/review/${session.id}/wallet-identity`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": token, origin: base },
        body: "{}"
      });
      expect(walletIdentity.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("serves wallet identity shell and records wallet identity lifecycle", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createWalletIdentitySession();
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const shell = await fetch(`${base}/connect/${session.id}`);
      expect(shell.status).toBe(200);
      // A token in the URL query is rejected; the token rides in the fragment.
      const connectQueryToken = await fetch(`${base}/connect/${session.id}?token=secret`);
      expect(connectQueryToken.status).toBe(400);
      expect((await connectQueryToken.json()).error).toBe("token_query_not_supported");
      expect(shell.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(shell.headers.get("content-security-policy")).toContain("style-src 'self' 'unsafe-inline'");
      expect(shell.headers.get("content-security-policy")).toContain("img-src 'self' data:");
      expect(shell.headers.get("content-security-policy")).not.toContain("script-src 'self' 'unsafe-inline'");
      const html = await shell.text();
      expect(html).toContain("/review-assets/connect.js");
      expect(html).toContain("/review-assets/connect.css");
      expect(html).not.toMatch(/sign/i);

      const missingToken = await fetch(`${base}/api/wallet/${session.id}/opened`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: "{}"
      });
      expect(missingToken.status).toBe(401);
      // A query token is rejected outright by the global guard (the token only
      // ever rides in the header), rather than being silently ignored and then
      // failing as missing auth.
      const queryToken = await fetch(`${base}/api/wallet/${session.id}/opened?token=${token}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: "{}"
      });
      expect(queryToken.status).toBe(400);
      expect(await queryToken.json()).toMatchObject({ error: "token_query_not_supported" });

      // A present-but-wrong header token is rejected like a missing one, so the
      // Connect page treats `opened` failure as an invalid token and shows no
      // wallet controls.
      const wrongToken = await fetch(`${base}/api/wallet/${session.id}/opened`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": "wrong-token", origin: base },
        body: "{}"
      });
      expect(wrongToken.status).toBe(401);

      const opened = await fetch(`${base}/api/wallet/${session.id}/opened`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: "{}"
      });
      expect(opened.status).toBe(200);
      expect(await opened.json()).toMatchObject({ status: "opened", walletSessionId: session.id });

      const connecting = await fetch(`${base}/api/wallet/${session.id}/connecting`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: "{}"
      });
      expect(connecting.status).toBe(200);
      expect(await connecting.json()).toMatchObject({ status: "connecting" });

      const connected = await fetch(`${base}/api/wallet/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ status: "connected", account: walletAccount, chain: "sui:mainnet" })
      });
      expect(connected.status).toBe(200);
      expect(await connected.json()).toMatchObject({
        status: "connected",
        account: walletAccount,
        chain: "sui:mainnet",
        expiresAt: expect.any(String)
      });
    } finally {
      await server.close();
    }
  });

  it("serves the local settings shell with external assets and rejects query tokens", async () => {
    const { server, created } = await createSettingsServer();
    try {
      const base = `http://${server.host}:${server.port}`;
      const queryToken = await fetch(`${base}/settings/${created.session.id}?token=${created.token}`);
      expect(queryToken.status).toBe(400);
      expect(await queryToken.json()).toMatchObject({ error: "token_query_not_supported" });

      const shell = await fetch(`${base}/settings/${created.session.id}`);
      expect(shell.status).toBe(200);
      expect(shell.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(shell.headers.get("content-security-policy")).toContain("style-src 'self' 'unsafe-inline'");
      expect(shell.headers.get("content-security-policy")).not.toContain("script-src 'self' 'unsafe-inline'");
      const html = await shell.text();
      expect(html).toContain("/review-assets/settings.js");
      expect(html).toContain("/review-assets/settings.css");
      expect(html).toContain(`data-settings-session-id="${created.session.id}"`);
    } finally {
      await server.close();
    }
  });

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

      // Binding happens only on the Connect page; Settings no longer mints a
      // wallet identity, so the endpoint is gone (no second binding path).
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
    const wallet = await store.createWalletIdentitySession();
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
      await expect(store.getWalletIdentitySession(wallet.session.id)).resolves.toBeUndefined();
      await expect(store.getSettingsSession(created.session.id)).resolves.toBeUndefined();
      const afterReset = await store.createWalletIdentitySession();
      expect(afterReset.session.status).toBe("pending");
    } finally {
      await server.close();
    }
  });

  it("serves built review assets and rejects traversal paths", async () => {
    const assetsDir = mkdtempSync(join(tmpdir(), "say-ur-intent-assets-"));
    writeFileSync(join(assetsDir, "review.js"), "export const review = true;\n", "utf8");
    writeFileSync(join(assetsDir, "review.css"), ".review-shell { color: #15201b; }\n", "utf8");
    writeFileSync(join(assetsDir, "connect.js"), "export const wallet = true;\n", "utf8");
    writeFileSync(join(assetsDir, "connect.css"), ".wallet-shell { color: #15201b; }\n", "utf8");
    writeFileSync(join(assetsDir, "settings.js"), "export const settings = true;\n", "utf8");
    writeFileSync(join(assetsDir, "settings.css"), ".settings-shell { color: #15201b; }\n", "utf8");
    const store = createSessionStore();
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      reviewAssetsDir: assetsDir
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const asset = await fetch(`${base}/review-assets/connect.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(await asset.text()).toContain("wallet = true");

      const css = await fetch(`${base}/review-assets/connect.css`);
      expect(css.status).toBe(200);
      expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
      expect(await css.text()).toContain(".wallet-shell");

      const reviewAsset = await fetch(`${base}/review-assets/review.js`);
      expect(reviewAsset.status).toBe(200);
      expect(reviewAsset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(await reviewAsset.text()).toContain("review = true");

      const reviewCss = await fetch(`${base}/review-assets/review.css`);
      expect(reviewCss.status).toBe(200);
      expect(reviewCss.headers.get("content-type")).toBe("text/css; charset=utf-8");
      expect(await reviewCss.text()).toContain(".review-shell");

      const settingsAsset = await fetch(`${base}/review-assets/settings.js`);
      expect(settingsAsset.status).toBe(200);
      expect(settingsAsset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(await settingsAsset.text()).toContain("settings = true");

      const missing = await fetch(`${base}/review-assets/missing.js`);
      expect(missing.status).toBe(404);

      const traversal = await fetch(`${base}/review-assets/..%2Fwallet.js`);
      expect(traversal.status).toBe(404);
    } finally {
      await server.close();
      rmSync(assetsDir, { recursive: true, force: true });
    }
  });

  it("rejects non-mainnet wallet identity result chains", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createWalletIdentitySession();
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/wallet/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ status: "connected", account: walletAccount, chain: "sui:testnet" })
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "input_invalid" });
    } finally {
      await server.close();
    }
  });

  it("returns client errors for invalid JSON and invalid transitions", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const invalidJson = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: "{"
      });
      expect(invalidJson.status).toBe(400);

      const invalidTokenWithInvalidJson = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": "wrong",
          origin: base
        },
        body: "{"
      });
      expect(invalidTokenWithInvalidJson.status).toBe(401);

      const invalidBodyShape = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify([plan.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])
      });
      expect(invalidBodyShape.status).toBe(400);
      const invalidBodyJson = (await invalidBodyShape.json()) as { error: string };
      expect(invalidBodyJson.error).toBe("invalid_body_shape");

      const invalidTransition = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "success", txDigest: "digest" })
      });
      expect(invalidTransition.status).toBe(400);
      expect(await invalidTransition.json()).toMatchObject({ error: "input_invalid" });

      const planMismatch = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: "missing_plan", status: "signed_pending_result", txDigest: "digest" })
      });
      expect(planMismatch.status).toBe(400);
      const mismatchJson = (await planMismatch.json()) as { error: string };
      expect(mismatchJson.error).toBe("plan_not_in_session");
    } finally {
      await server.close();
    }
  });

  it("exposes expired status in result polling", async () => {
    const store = createSessionStore({ ttlMs: 1 });
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const base = `http://${server.host}:${server.port}`;
      const unauthenticated = await fetch(`${base}/api/result/${session.id}`);
      expect(unauthenticated.status).toBe(401);

      const result = await fetch(`${base}/api/result/${session.id}`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      expect(result.status).toBe(200);
      const json = (await result.json()) as { status: string };
      expect(json.status).toBe("expired");
    } finally {
      await server.close();
    }
  });

  it("serves public receipt facts for the retained Review result without granting token authority", async () => {
    const store = createSessionStore();
    const readerDigests: string[] = [];
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      publicChainReceiptReader: async (input) => {
        readerDigests.push(input.digest);
        if (input.digest === "bad") {
          return { status: "invalid_digest" };
        }
        if (input.digest === "missing") {
          return { status: "not_found" };
        }
        if (input.digest === "down") {
          return { status: "unavailable", message: "Sui mainnet transaction lookup failed." };
        }
        return {
          status: "found",
          receipt: {
            txDigest: "0xabc",
            sender: walletAccount,
            effectsStatus: { success: true },
            packageCalls: [],
            balanceChanges: [
              {
                index: 0,
                address: walletAccount,
                coinType: "0x2::sui::SUI",
                amountRaw: "-1000",
                direction: "decrease"
              }
            ],
            objectTypes: {},
            gas: {
              totalMist: "1000",
              computationMist: "1000",
              storageMist: "0",
              storageRebateMist: "0",
              nonRefundableStorageMist: "0",
              budgetMist: "2000",
              priceMist: "1",
              paymentObjectId: "0xpay"
            },
            inputs: [],
            events: [],
            ptbGraph: undefined,
            chainIdentifier: "abcdefgh",
            // Fixed so two identical reads return byte-identical bodies; lets the
            // header-token case below assert the response is unchanged.
            fetchedAt: "2026-06-28T00:00:00.000Z"
          }
        };
      }
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;

      // Public endpoint: no token required, and a query token is rejected before
      // the reader is consulted.
      const queryToken = await fetch(`${base}/api/receipt?digest=ok&token=secret`);
      expect(queryToken.status).toBe(400);
      expect(await queryToken.json()).toEqual({ error: "token_query_not_supported" });

      const invalid = await fetch(`${base}/api/receipt?digest=bad`);
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "digest_invalid" });

      const missing = await fetch(`${base}/api/receipt?digest=missing`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "receipt_not_found" });

      const down = await fetch(`${base}/api/receipt?digest=down`);
      expect(down.status).toBe(502);
      expect(await down.json()).toEqual({ error: "receipt_unavailable" });

      const ok = await fetch(`${base}/api/receipt?digest=ok`);
      expect(ok.status).toBe(200);
      const json = (await ok.json()) as Record<string, unknown>;
      expect(json).toMatchObject({
        txDigest: "0xabc",
        sender: walletAccount,
        effectsStatus: { success: true }
      });
      // Public receipt facts never carry review/session/wallet/signing material.
      for (const forbidden of [
        "token",
        "reviewSessionId",
        "walletSessionId",
        "reviewedRequest",
        "reviewState",
        "labeledSessionFacts",
        "transactionBytes",
        "signingReadiness",
        "walletReviewAdapterContract"
      ]) {
        expect(json).not.toHaveProperty(forbidden);
      }

      // A header token grants NO authority on this public endpoint: the same
      // request carrying x-say-ur-intent-token returns the identical public
      // facts, never extra or token-gated data. This pins the public boundary so
      // a future change cannot quietly make /api/receipt header-authorized.
      const withHeaderToken = await fetch(`${base}/api/receipt?digest=ok`, {
        headers: { "x-say-ur-intent-token": "secret" }
      });
      expect(withHeaderToken.status).toBe(200);
      expect(await withHeaderToken.json()).toEqual(json);

      expect(readerDigests).toEqual(["bad", "missing", "down", "ok", "ok"]);
    } finally {
      await server.close();
    }
  });

  it("reports expired when a signed pending result outlives the session", async () => {
    const store = createSessionStore({ ttlMs: 20 });
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    await store.recordExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: "digest",
      recordedAt: new Date().toISOString()
    });
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const base = `http://${server.host}:${server.port}`;
      const result = await fetch(`${base}/api/result/${session.id}`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      expect(result.status).toBe(200);
      const json = (await result.json()) as { status: string };
      expect(json.status).toBe("expired");
    } finally {
      await server.close();
    }
  });

  it("allows review opened on final or expired sessions without mutating activity", async () => {
    const store = createSessionStore({ ttlMs: 20 });
    const { session, token } = await store.createReviewSession([plan], new Date(0));
    await openAndConnectReview(store, session.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Date(1));
    await store.recordReviewState(
      session.id,
      {
        planId: plan.id,
        reviewSessionId: session.id,
        account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "ready_for_wallet_review",
        checks: [],
        updatedAt: new Date(2).toISOString()
      },
      new Date(2)
    );
    await store.recordExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: chainReceiptDigest,
        recordedAt: new Date(3).toISOString()
      },
      new Date(3)
    );
    await store.recordChainExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "success",
        txDigest: chainReceiptDigest,
        chainReceipt: chainReceiptFixture(),
        recordedAt: new Date(4).toISOString()
      },
      new Date(4)
    );
    const { session: expiredSession, token: expiredToken } = await store.createReviewSession(
      [{ ...plan, id: "plan_2" }],
      new Date(10)
    );
    await openAndConnectReview(store, expiredSession.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Date(11));
    await store.recordReviewState(
      expiredSession.id,
      {
        planId: "plan_2",
        reviewSessionId: expiredSession.id,
        account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "ready_for_wallet_review",
        checks: [],
        updatedAt: new Date(12).toISOString()
      },
      new Date(12)
    );
    await store.recordExecutionResult(
      expiredSession.id,
      {
        reviewSessionId: expiredSession.id,
        planId: "plan_2",
        status: "signed_pending_result",
        txDigest: "digest_2",
        recordedAt: new Date(13).toISOString()
      },
      new Date(13)
    );
    await store.getReviewSession(expiredSession.id, new Date(31));
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/review/${session.id}/opened`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: "{}"
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as { internalStatus: string; lastActivityAt: string };
      expect(json.internalStatus).toBe("success");
      expect(json.lastActivityAt).toBe(new Date(4).toISOString());

      const expiredResponse = await fetch(`${base}/api/review/${expiredSession.id}/opened`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": expiredToken,
          origin: base
        },
        body: "{}"
      });
      expect(expiredResponse.status).toBe(200);
      const expiredJson = (await expiredResponse.json()) as { internalStatus: string; lastActivityAt: string };
      expect(expiredJson.internalStatus).toBe("expired");
      expect(expiredJson.lastActivityAt).toBe(new Date(13).toISOString());
    } finally {
      await server.close();
    }
  });

  it("rejects expired result POST with a lifecycle error after token validation", async () => {
    const store = createSessionStore({ ttlMs: 1 });
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "signed_pending_result", txDigest: "late" })
      });
      expect(response.status).toBe(410);
      const json = (await response.json()) as { error: string };
      expect(json.error).toBe("session_expired");
    } finally {
      await server.close();
    }
  });

  it("reports blocked status for blocked review sessions", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);
      await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
      });

      const result = await fetch(`${base}/api/result/${session.id}`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      const json = (await result.json()) as { status: string };
      expect(json.status).toBe("blocked");
    } finally {
      await server.close();
    }
  });

  it("rejects review state recomputation for a different account", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const headers = {
        "content-type": "application/json",
        "x-say-ur-intent-token": token,
        origin: base
      };
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);
      const first = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: plan.id, account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
      });
      expect(first.status).toBe(200);

      const second = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: plan.id, account: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })
      });
      expect(second.status).toBe(409);
      const json = (await second.json()) as { error: string };
      expect(json.error).toBe("invalid_session_transition");
    } finally {
      await server.close();
    }
  });

  it("rejects page-submitted success even when the session is already finalized", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    await store.recordExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: chainReceiptDigest,
      recordedAt: new Date().toISOString()
    });
    await store.recordChainExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "success",
      txDigest: chainReceiptDigest,
      chainReceipt: chainReceiptFixture(),
      recordedAt: new Date().toISOString()
    });

    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const overwrite = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "success", txDigest: otherChainReceiptDigest })
      });
      expect(overwrite.status).toBe(400);
      const json = (await overwrite.json()) as { error: string };
      expect(json.error).toBe("input_invalid");
    } finally {
      await server.close();
    }
  });

  it("returns stored execution result for idempotent signed pending retries", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    await store.recordExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: "same",
      recordedAt: "stored-recorded-at"
    });

    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const retry = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "signed_pending_result", txDigest: "same" })
      });
      expect(retry.status).toBe(200);
      const json = (await retry.json()) as { executionResult: { recordedAt: string } };
      expect(json.executionResult.recordedAt).toBe("stored-recorded-at");
    } finally {
      await server.close();
    }
  });

  it("reports signed pending result conflicts through HTTP", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    await store.recordExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: "first",
      recordedAt: new Date().toISOString()
    });

    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const conflict = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({
          planId: plan.id,
          status: "signed_pending_result",
          txDigest: "second"
        })
      });
      expect(conflict.status).toBe(409);
      const json = (await conflict.json()) as { error: string };
      expect(json.error).toBe("signed_pending_result_conflict");

      const finalConflict = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({
          planId: plan.id,
          status: "success",
          txDigest: "second"
        })
      });
      expect(finalConflict.status).toBe(400);
      expect((await finalConflict.json()) as { error: string }).toMatchObject({
        error: "input_invalid"
      });
    } finally {
      await server.close();
    }
  });

  it("requires failureReason for failed execution result posts", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });

    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const headers = {
        "content-type": "application/json",
        "x-say-ur-intent-token": token,
        origin: base
      };
      const pending = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: plan.id, status: "signed_pending_result", txDigest: "digest" })
      });
      expect(pending.status).toBe(200);

      const missingReason = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: plan.id, status: "failure" })
      });
      expect(missingReason.status).toBe(400);
      expect((await missingReason.json()) as { error: string }).toMatchObject({ error: "input_invalid" });

      const failureAfterPending = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: plan.id, status: "failure", failureReason: "network_error" })
      });
      expect(failureAfterPending.status).toBe(409);
      expect((await failureAfterPending.json()) as { error: string }).toMatchObject({
        error: "signed_pending_result_conflict"
      });
    } finally {
      await server.close();
    }
  });

  it("records local pre-chain failures from the page before a signed digest exists", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });

    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "failure", failureReason: "wallet_rejected" })
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        executionResult: {
          status: "failure",
          failureReason: "wallet_rejected"
        }
      });
    } finally {
      await server.close();
    }
  });

  it("verifies signed pending result posts through server-owned chain receipt finalization", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    attachReviewedCommitment(store, session.id);
    const chainReceiptVerifier = async () => ({
      status: "verified_success" as const,
      receipt: chainReceiptFixture()
    });
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      chainReceiptVerifier
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "signed_pending_result", txDigest: chainReceiptDigest })
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as { executionResult: { status: string; chainReceipt?: unknown } };
      expect(json.executionResult).toMatchObject({
        status: "success",
        txDigest: chainReceiptDigest,
        chainReceipt: { kind: "sui_chain_receipt_v1" }
      });
    } finally {
      await server.close();
    }
  });

  it("lazy-verifies pending result reads and closes unavailable receipts after the lookup window", async () => {
    const store = createSessionStore({ ttlMs: 100 * 365 * 24 * 60 * 60 * 1000 });
    const { session, token } = await store.createReviewSession([plan], new Date("2026-06-25T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-25T00:00:01.000Z"));
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: "2026-06-25T00:00:02.000Z"
    }, new Date("2026-06-25T00:00:02.000Z"));
    attachReviewedCommitment(store, session.id);
    await store.recordExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: chainReceiptDigest,
      recordedAt: "2026-06-25T00:00:03.000Z"
    }, new Date("2026-06-25T00:00:03.000Z"));
    const chainReceiptVerifier = async () => ({
      status: "not_found" as const,
      failureReason: "chain_receipt_unavailable" as const,
      message: "not indexed"
    });
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      chainReceiptVerifier
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/result/${session.id}`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "failure",
        executionResult: {
          status: "failure",
          failureReason: "chain_receipt_unavailable",
          txDigest: chainReceiptDigest
        }
      });
    } finally {
      await server.close();
    }
  });

  it("exposes internal and polling status separately in review lookup", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const missingToken = await fetch(`${base}/api/review/${session.id}`);
      expect(missingToken.status).toBe(401);

      const response = await fetch(`${base}/api/review/${session.id}`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as { internalStatus: string; pollingStatus: string };
      expect(json.internalStatus).toBe("wallet_connected");
      expect(json.pollingStatus).toBe("awaiting_signature");
    } finally {
      await server.close();
    }
  });
});

describe("review page content security policy", () => {
  it("allows browser-side signed-transaction submission to the Sui fullnode", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({ host: "127.0.0.1", store, logger }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/review/${session.id}`);
      expect(response.status).toBe(200);
      const csp = response.headers.get("content-security-policy") ?? "";
      const connectSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("connect-src"));
      expect(connectSrc).toBeDefined();
      expect(connectSrc).toContain("'self'");
      // The page signs then submits to the fullnode directly; without this the
      // submission is blocked by CSP. Host must be port-less to match the
      // browser's default-port (443) request.
      expect(connectSrc).toContain("https://fullnode.mainnet.sui.io");
      expect(connectSrc).not.toContain("fullnode.mainnet.sui.io:443");
    } finally {
      await server.close();
    }
  });
});

describe("page security rules across all pages", () => {

  it("token pages serve no cross-page navigation", async () => {
    const store = createSessionStore();
    const review = await store.createReviewSession([plan]);
    const wallet = await store.createWalletIdentitySession();
    const settings = await store.createSettingsSession();
    const server = await createReviewHttpServer({ host: "127.0.0.1", store, logger }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const tokenPaths = [
        `/review/${review.session.id}`,
        `/connect/${wallet.session.id}`,
        `/settings/${settings.session.id}`
      ];
      for (const path of tokenPaths) {
        const res = await fetch(`${base}${path}`);
        expect(res.status, path).toBe(200);
        const html = await res.text();
        expect(html, `${path} has no public-nav`).not.toContain('class="public-nav"');
        for (const publicLink of ['href="/account"', 'href="/receipt"', 'href="/charts/deepbook-usdc"']) {
          expect(html, `${path} must not link ${publicLink}`).not.toContain(publicLink);
        }
      }
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
});


describe("retired read-page routes", () => {
  it("returns JSON not-found for replaced pages, read APIs and the unsigned identity probe", async () => {
    const server = await createReviewHttpServer({ host: "127.0.0.1", store: createSessionStore(), logger }).start(0);
    try {
      for (const path of ["/", "/account", "/receipt", "/charts/deepbook-usdc", "/api/account/assets", "/api/account/active-account", "/api/charts/deepbook-usdc/pools", "/api/charts/deepbook-usdc/candles", "/__identity", "/no-such-page"]) {
        const result = await fetch("http://127.0.0.1:" + server.port + path, { headers: { accept: "text/html" } });
        expect(result.status, path).toBe(404);
        expect(result.headers.get("content-type"), path).toContain("application/json");
        expect(await result.json(), path).toEqual({ error: "not_found" });
      }
    } finally { await server.close(); }
  });
});
