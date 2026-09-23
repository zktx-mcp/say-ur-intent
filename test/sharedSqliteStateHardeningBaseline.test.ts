import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { ActionPlan, ReviewSession, ReviewState } from "../src/core/action/types.js";
import { SqliteActivityStore } from "../src/core/activity/sqliteActivityStore.js";
import {
  configureDatabase,
  initializeDatabase
} from "../src/core/activity/sqliteActivityStoreSchema.js";
import { validateSupportedAdapterLifecycle } from "../src/adapters/adapterLifecycleValidators.js";
import { SqliteSessionRecordStore } from "../src/core/session/sqliteSessionStore.js";
import type { SessionRecordStore } from "../src/core/session/sessionRecordStore.js";
import { chainReceiptDigest, chainReceiptFixture, otherChainReceiptDigest } from "./fixtures/chainReceipt.js";

const walletAccount = `0x${"a".repeat(64)}`;

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
  createdAt: "2026-06-26T00:00:00.000Z"
};

function readyReviewState(reviewSessionId = "review_1"): ReviewState {
  return {
    planId: plan.id,
    reviewSessionId,
    account: walletAccount,
    status: "ready_for_wallet_review",
    checks: [],
    updatedAt: "2026-06-26T00:00:00.000Z"
  };
}

function readySession(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    id: "review_1",
    tokenHash: "token_hash",
    status: "ready_for_wallet_review",
    account: walletAccount,
    plans: [plan],
    reviewState: readyReviewState(),
    createdAt: "2026-06-26T00:00:00.000Z",
    expiresAt: "2026-06-26T00:30:00.000Z",
    lastActivityAt: "2026-06-26T00:00:00.000Z",
    ...overrides
  };
}

function awaitingWalletSession(): ReviewSession {
  return {
    id: "review_1",
    tokenHash: "token_hash",
    status: "awaiting_wallet",
    plans: [plan],
    createdAt: "2026-06-26T00:00:00.000Z",
    expiresAt: "2026-06-26T00:30:00.000Z",
    lastActivityAt: "2026-06-26T00:00:00.000Z"
  };
}

function signedPendingSession(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return readySession({
    status: "signed_pending_result",
    executionResult: {
      reviewSessionId: "review_1",
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: chainReceiptDigest,
      recordedAt: "2026-06-26T00:00:05.000Z"
    },
    lastActivityAt: "2026-06-26T00:00:05.000Z",
    ...overrides
  });
}

function withTwoStores<T>(fn: (stores: {
  first: SessionRecordStore;
  second: SessionRecordStore;
  firstDb: Database.Database;
  secondDb: Database.Database;
}) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "say-ur-intent-shared-state-baseline-"));
  const dbPath = join(dir, "say-ur-intent.sqlite");
  const firstDb = new Database(dbPath);
  const secondDb = new Database(dbPath);
  try {
    for (const db of [firstDb, secondDb]) {
      configureDatabase(db);
      initializeDatabase(db);
    }
    return fn({
      first: new SqliteSessionRecordStore(firstDb),
      second: new SqliteSessionRecordStore(secondDb),
      firstDb,
      secondDb
    });
  } finally {
    firstDb.close();
    secondDb.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("shared SQLite state hardening baseline", () => {
  it("prevents a stale live-session transition from overwriting a server-owned chain finalization", () => {
    withTwoStores(({ first, second }) => {
      first.create("review_1", signedPendingSession());
      const staleForChain = first.get("review_1")!;
      const staleForPage = second.get("review_1")!;

      expect(first.commitReviewSessionTransition("review_1", staleForChain, {
        ...staleForChain,
        status: "success",
        executionResult: {
          reviewSessionId: "review_1",
          planId: plan.id,
          status: "success",
          txDigest: chainReceiptDigest,
          chainReceipt: chainReceiptFixture(),
          recordedAt: "2026-06-26T00:00:10.000Z"
        },
        lastActivityAt: "2026-06-26T00:00:10.000Z"
      })).toBe(true);
      expect(second.commitReviewSessionTransition("review_1", staleForPage, {
        ...staleForPage,
        status: "signed_pending_result",
        executionResult: {
          reviewSessionId: "review_1",
          planId: plan.id,
          status: "signed_pending_result",
          txDigest: chainReceiptDigest,
          recordedAt: "2026-06-26T00:00:11.000Z"
        },
        lastActivityAt: "2026-06-26T00:00:11.000Z"
      })).toBe(false);

      expect(first.get("review_1")).toMatchObject({
        status: "success",
        executionResult: {
          status: "success",
          txDigest: chainReceiptDigest
        }
      });
    });
  });

  it("prevents stale recompute from clearing an outstanding handoff lock", () => {
    withTwoStores(({ first, second }) => {
      first.create("review_1", readySession());
      const staleForRecompute = first.get("review_1")!;

      expect(second.acquireHandoffLock("review_1", chainReceiptDigest)).toBe(true);
      expect(first.commitReviewSessionTransition("review_1", staleForRecompute, {
        ...staleForRecompute,
        status: "refresh_required",
        reviewState: {
          planId: plan.id,
          reviewSessionId: "review_1",
          account: walletAccount,
          status: "refresh_required",
          refreshReason: "quote_stale",
          checks: [],
          updatedAt: "2026-06-26T00:00:10.000Z"
        },
        lastActivityAt: "2026-06-26T00:00:10.000Z"
      })).toBe(false);

      const after = second.get("review_1");
      expect(after).toMatchObject({
        status: "ready_for_wallet_review",
        pendingHandoffDigest: chainReceiptDigest
      });
    });
  });

  it("prevents stale page results from overwriting an accepted pending digest", () => {
    withTwoStores(({ first, second }) => {
      first.create("review_1", readySession());
      const staleFirstPage = first.get("review_1")!;
      const staleSecondPage = second.get("review_1")!;

      expect(first.commitReviewSessionTransition("review_1", staleFirstPage, {
        ...staleFirstPage,
        status: "signed_pending_result",
        executionResult: {
          reviewSessionId: "review_1",
          planId: plan.id,
          status: "signed_pending_result",
          txDigest: chainReceiptDigest,
          recordedAt: "2026-06-26T00:00:05.000Z"
        },
        lastActivityAt: "2026-06-26T00:00:05.000Z"
      })).toBe(true);
      expect(second.commitReviewSessionTransition("review_1", staleSecondPage, {
        ...staleSecondPage,
        status: "signed_pending_result",
        executionResult: {
          reviewSessionId: "review_1",
          planId: plan.id,
          status: "signed_pending_result",
          txDigest: otherChainReceiptDigest,
          recordedAt: "2026-06-26T00:00:06.000Z"
        },
        lastActivityAt: "2026-06-26T00:00:06.000Z"
      })).toBe(false);

      expect(first.get("review_1")).toMatchObject({
        status: "signed_pending_result",
        executionResult: {
          status: "signed_pending_result",
          txDigest: chainReceiptDigest
        }
      });
    });
  });

  it("prevents stale expiry from overwriting a final execution result", () => {
    withTwoStores(({ first, second }) => {
      first.create("review_1", signedPendingSession());
      const staleForExpiry = second.get("review_1")!;
      const current = first.get("review_1")!;

      expect(first.commitReviewSessionTransition("review_1", current, {
        ...current,
        status: "success",
        executionResult: {
          reviewSessionId: "review_1",
          planId: plan.id,
          status: "success",
          txDigest: chainReceiptDigest,
          chainReceipt: chainReceiptFixture(),
          recordedAt: "2026-06-26T00:00:10.000Z"
        },
        lastActivityAt: "2026-06-26T00:00:10.000Z"
      })).toBe(true);
      expect(second.commitReviewSessionTransition("review_1", staleForExpiry, {
        ...staleForExpiry,
        status: "expired",
        lastActivityAt: "2026-06-26T00:00:11.000Z"
      })).toBe(false);

      expect(first.get("review_1")).toMatchObject({
        status: "success",
        executionResult: {
          status: "success",
          txDigest: chainReceiptDigest
        }
      });
    });
  });

  it("prevents stale active-account binding from overwriting the committed account", () => {
    withTwoStores(({ first, second }) => {
      first.create("review_1", awaitingWalletSession());
      const staleForBinding = first.get("review_1")!;
      const secondCurrent = second.get("review_1")!;

      expect(second.commitReviewSessionTransition("review_1", secondCurrent, {
        ...secondCurrent,
        account: `0x${"b".repeat(64)}`,
        lastActivityAt: "2026-06-26T00:00:09.000Z"
      })).toBe(true);
      expect(first.commitReviewSessionTransition("review_1", staleForBinding, {
        ...staleForBinding,
        status: "wallet_connected",
        account: walletAccount,
        lastActivityAt: "2026-06-26T00:00:10.000Z"
      })).toBe(false);

      expect(second.get("review_1")).toMatchObject({
        account: `0x${"b".repeat(64)}`
      });
    });
  });

  it("rejects revision-unaware SQL writers after the hardened schema exists", () => {
    withTwoStores(({ first, secondDb }) => {
      first.create("review_1", readySession());

      expect(() => {
        secondDb
          .prepare(
            `UPDATE live_review_sessions
             SET status = 'refresh_required'
             WHERE id = ?`
          )
          .run("review_1");
      }).toThrow("hardened write contract");

      expect(first.get("review_1")).toMatchObject({
        status: "ready_for_wallet_review"
      });

      expect(() => {
        secondDb
          .prepare(
            `INSERT INTO live_review_sessions
               (id, token_hash, status, plans_json, created_at, expires_at, last_activity_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            "review_2",
            "token_hash",
            "proposed",
            JSON.stringify([plan]),
            "2026-06-26T00:00:00.000Z",
            "2026-06-26T00:30:00.000Z",
            "2026-06-26T00:00:00.000Z"
          );
      }).toThrow();
    });
  });

  it("refuses legacy live review sessions without rewriting them", () => {
    const dir = mkdtempSync(join(tmpdir(), "say-ur-intent-live-session-migration-"));
    const dbPath = join(dir, "say-ur-intent.sqlite");
    const db = new Database(dbPath);
    try {
      configureDatabase(db);
      db.exec(`
        CREATE TABLE live_review_sessions (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          account TEXT,
          pending_handoff_digest TEXT,
          plans_json TEXT NOT NULL,
          review_state_json TEXT,
          execution_result_json TEXT,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          last_activity_at TEXT NOT NULL
        );
        CREATE TABLE live_private_review_artifacts (
          review_session_id TEXT PRIMARY KEY
            REFERENCES live_review_sessions(id) ON DELETE CASCADE,
          artifacts_json TEXT NOT NULL
        );
      `);
      const session = readySession();
      db.prepare(
        `INSERT INTO live_review_sessions
           (id, token_hash, status, account, pending_handoff_digest, plans_json,
            review_state_json, execution_result_json, created_at, expires_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        session.id,
        session.tokenHash,
        session.status,
        session.account ?? null,
        session.pendingHandoffDigest ?? null,
        JSON.stringify(session.plans),
        JSON.stringify(session.reviewState),
        null,
        session.createdAt,
        session.expiresAt,
        session.lastActivityAt
      );
      db.prepare(`INSERT INTO live_private_review_artifacts (review_session_id, artifacts_json) VALUES (?, ?)`)
        .run(session.id, JSON.stringify({ transactionMaterial: { materialId: "material_1" } }));
      db.pragma("user_version = 5");

      expect(() => initializeDatabase(db)).toThrow("format does not match");
      expect(db.pragma("user_version", { simple: true })).toBe(5);
      expect(db.prepare("SELECT plans_json FROM live_review_sessions WHERE id = ?").get(session.id))
        .toEqual({ plans_json: JSON.stringify(session.plans) });
      expect((db.prepare("SELECT COUNT(*) AS count FROM live_private_review_artifacts").get() as { count: number }).count).toBe(1);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps handoff locking as a revision-aware conditional cross-process write", () => {
    withTwoStores(({ first, second }) => {
      expect(first.releaseHandoffLock("missing_review")).toBe(false);
      first.create("review_1", readySession());

      expect(first.acquireHandoffLock("review_1", chainReceiptDigest)).toBe(true);
      expect(second.acquireHandoffLock("review_1", otherChainReceiptDigest)).toBe(false);
      expect(second.acquireHandoffLock("review_1", chainReceiptDigest)).toBe(true);
      expect(second.get("review_1")).toMatchObject({
        pendingHandoffDigest: chainReceiptDigest
      });
    });
  });

  it("rolls back audit writes when a stale live-session transition loses the race", async () => {
    const dir = mkdtempSync(join(tmpdir(), "say-ur-intent-shared-state-activity-"));
    const dbPath = join(dir, "say-ur-intent.sqlite");
    const firstStore = new SqliteActivityStore({
      databasePath: dbPath,
      validateAdapterLifecycle: validateSupportedAdapterLifecycle
    });
    const secondStore = new SqliteActivityStore({
      databasePath: dbPath,
      validateAdapterLifecycle: validateSupportedAdapterLifecycle
    });
    const observerDb = new Database(dbPath);
    try {
      const firstSessions = firstStore.createSessionRecordStore();
      const secondSessions = secondStore.createSessionRecordStore();
      const initial = signedPendingSession();
      expect(
        await firstStore.recordReviewSessionWithLiveSession?.(
          {
            reviewSessionId: initial.id,
            plan,
            currentStatus: initial.status,
            createdAt: initial.createdAt
          },
          { next: initial }
        )
      ).toBe(true);

      const firstExpected = firstSessions.get(initial.id)!;
      const staleForExpiry = secondSessions.get(initial.id)!;
      const successSession: ReviewSession = {
        ...firstExpected,
        status: "success",
        executionResult: {
          reviewSessionId: initial.id,
          planId: plan.id,
          status: "success",
          txDigest: chainReceiptDigest,
          chainReceipt: chainReceiptFixture(),
          recordedAt: "2026-06-26T00:00:10.000Z"
        },
        lastActivityAt: "2026-06-26T00:00:10.000Z"
      };
      await firstStore.recordReviewExecutionWithLiveSession?.(
        {
          reviewSessionId: initial.id,
          planId: plan.id,
          account: walletAccount,
          fromStatus: firstExpected.status,
          status: "success",
          txDigest: chainReceiptDigest,
          result: successSession.executionResult!,
          recordedAt: "2026-06-26T00:00:10.000Z"
        },
        { expected: firstExpected, next: successSession, deleteTransactionMaterials: true }
      );

      const expiredSession: ReviewSession = {
        ...staleForExpiry,
        status: "expired",
        lastActivityAt: "2026-06-26T00:00:11.000Z"
      };
      const staleCommitted = await secondStore.recordReviewTransitionWithLiveSession?.(
        {
          reviewSessionId: initial.id,
          event: "expired",
          fromStatus: staleForExpiry.status,
          toStatus: "expired",
          transitionedAt: "2026-06-26T00:00:11.000Z"
        },
        { expected: staleForExpiry, next: expiredSession, deleteTransactionMaterials: true }
      );

      expect(staleCommitted).toBe(false);
      expect(firstSessions.get(initial.id)).toMatchObject({
        status: "success",
        executionResult: { status: "success", txDigest: chainReceiptDigest }
      });
      expect(
        (
          observerDb
            .prepare(`SELECT COUNT(*) AS count FROM review_status_transitions WHERE event = 'expired'`)
            .get() as { count: number }
        ).count
      ).toBe(0);
      expect(
        (
          observerDb
            .prepare(`SELECT status, tx_digest FROM review_executions WHERE review_session_id = ?`)
            .get(initial.id) as { status: string; tx_digest: string }
        )
      ).toEqual({ status: "success", tx_digest: chainReceiptDigest });
    } finally {
      observerDb.close();
      firstStore.close();
      secondStore.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checks the active account inside the wallet-binding transaction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "say-ur-intent-active-account-binding-"));
    const dbPath = join(dir, "say-ur-intent.sqlite");
    const firstStore = new SqliteActivityStore({
      databasePath: dbPath,
      validateAdapterLifecycle: validateSupportedAdapterLifecycle
    });
    const secondStore = new SqliteActivityStore({
      databasePath: dbPath,
      validateAdapterLifecycle: validateSupportedAdapterLifecycle
    });
    const observerDb = new Database(dbPath);
    try {
      const sessions = firstStore.createSessionRecordStore();
      const initial = awaitingWalletSession();
      expect(
        await firstStore.recordReviewSessionWithLiveSession?.(
          {
            reviewSessionId: initial.id,
            plan,
            currentStatus: initial.status,
            createdAt: initial.createdAt
          },
          { next: initial }
        )
      ).toBe(true);
      await firstStore.setActiveAccount(walletAccount, "wallet_identity", new Date("2026-06-26T00:00:01.000Z"));
      const staleExpected = sessions.get(initial.id)!;
      await secondStore.setActiveAccount(
        `0x${"b".repeat(64)}`,
        "wallet_identity",
        new Date("2026-06-26T00:00:02.000Z")
      );

      await expect(
        firstStore.recordReviewTransitionWithLiveSession?.(
          {
            reviewSessionId: initial.id,
            event: "wallet_connected",
            fromStatus: initial.status,
            toStatus: "wallet_connected",
            account: walletAccount,
            transitionedAt: "2026-06-26T00:00:03.000Z"
          },
          {
            expected: staleExpected,
            next: {
              ...staleExpected,
              status: "wallet_connected",
              account: walletAccount,
              lastActivityAt: "2026-06-26T00:00:03.000Z"
            }
          }
        )
      ).rejects.toThrow("active account changed");

      expect(sessions.get(initial.id)).toMatchObject({ status: "awaiting_wallet" });
      expect(
        (
          observerDb
            .prepare(`SELECT COUNT(*) AS count FROM review_status_transitions WHERE event = 'wallet_connected'`)
            .get() as { count: number }
        ).count
      ).toBe(0);
    } finally {
      observerDb.close();
      firstStore.close();
      secondStore.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
