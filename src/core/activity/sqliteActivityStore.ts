import { isDeepStrictEqual } from "node:util";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { AdapterLifecycleValidator } from "../action/adapterLifecycleValidation.js";
import { assertNoForbiddenMcpFields } from "../action/forbiddenFields.js";
import { parseLifecycleValidatedReviewState } from "../action/reviewStateValidation.js";
import { actionPlanSchema, executionResultSchema } from "../action/schemas.js";
import type { ActionPlan, ExecutionResult, ReviewState } from "../action/types.js";
import { parseSuiAddress } from "../suiAddress.js";
import { SqlitePreferencesRepository } from "../preferences/sqlitePreferencesRepository.js";
import { SqliteTransactionMaterialStore } from "../session/sqliteTransactionMaterialStore.js";
import { SqliteCardRecordStore } from "../session/sqliteCardStore.js";
import type { LocalTransactionMaterialStore } from "../session/transactionMaterialStore.js";
import {
  SqliteSessionRecordStore,
  SqlitePrivateReviewArtifactStore,
  createSqliteWalletIdentityRecordStore,
  createSqliteSettingsRecordStore,
  sessionFromLiveReviewSessionRow,
  insertLiveReviewSessionRow,
  updateLiveReviewSessionRow,
  type LiveReviewSessionRow
} from "../session/sqliteSessionStore.js";
import type { SessionRecordStore } from "../session/sessionRecordStore.js";
import type { PrivateReviewArtifactStore } from "../session/privateReviewArtifacts.js";
import type { KeyedRecordStore } from "../session/keyedRecordStore.js";
import type { WalletIdentitySession } from "../session/walletIdentity.js";
import type { SettingsSession } from "../session/settingsSession.js";
import type {
  CoinMetadataCache,
  CoinMetadataCacheLookup,
  CoinMetadataCacheRecord
} from "../read/coinMetadata.js";
import { SqliteLocalDataService, type SqliteLocalDataServiceOptions } from "./localDataService.js";
import { buildExternalActivityCoverageResult } from "./externalActivityCoverage.js";
import {
  buildExternalActivityTransactionStreamResult,
  canonicalExternalActivityTransactions
} from "./externalActivityTransactionStream.js";
import type {
  AccountRecord,
  AccountSource,
  ActiveAccountRecord,
  ActivityStore,
  ExternalActivityCoverageFilter,
  ExternalActivityCoverageResult,
  ExternalActivityScanInput,
  ExternalActivityScanRecord,
  ExternalActivitySummaryFilter,
  ExternalActivitySummaryResult,
  ExternalActivityTransactionStreamFilter,
  ExternalActivityTransactionStreamResult,
  ExternalActivityTransactionRecord,
  ReviewActivityFilter,
  ReviewActivityListFilter,
  ReviewActivityListResult,
  ReviewFunnelSummary,
  ReviewFunnelSummaryResult,
  ReviewSessionEvidenceInput,
  ReviewSessionDetailInput,
  ReviewSessionDetailResult,
  ReviewExecutionInput,
  ReviewExecutionRecord,
  ReviewStateSnapshotInput,
  ReviewTransitionInput,
  LiveReviewSessionMutation
} from "./activityStore.js";
import {
  ActivityStoreReadError,
  EXTERNAL_ACTIVITY_COVERAGE_SCAN_MAX_RECORDS,
  REVIEW_ACTIVITY_DETAIL_MAX_ITEMS,
  REVIEW_ACTIVITY_LOW_SAMPLE_THRESHOLD
} from "./activityStore.js";
import {
  assertCurrentDatabaseFormat,
  configureDatabase,
  initializeDatabase
} from "./sqliteActivityStoreSchema.js";
import {
  ActivityStoreError,
  type SqliteActivityStoreOptions,
  type SqliteDatabase
} from "./sqliteActivityStoreTypes.js";
import {
  EXTERNAL_ACTIVITY_RELATIONSHIPS,
  EXTERNAL_ACTIVITY_STATUSES,
  INTERNAL_SESSION_STATUSES,
  REVIEW_STATE_STATUSES,
  REVIEW_TRANSITION_EVENTS,
  type AccountRow,
  type ActiveAccountRow,
  type CoinMetadataCacheRow,
  type CountRow,
  type ExternalActivityScanRow,
  type ExternalActivityTransactionRow,
  type KeyCountRow,
  type ReviewActivityListRow,
  type ReviewActivityScope,
  type ReviewExecutionRow,
  type ReviewExecutionStorageRow,
  type ReviewSessionDetailRow,
  type ReviewStateSnapshotRow,
  type ReviewTransitionRow,
  type TimingRow,
  asAccountSource,
  asInternalSessionStatus,
  asReviewTransitionEvent,
  asString,
  assertDateRange,
  canAdvanceReviewExecution,
  coinMetadataCacheRecordFromRow,
  countMap,
  emptyExternalActivitySummaryStats,
  emptyReviewFunnelSummary,
  externalActivityScanFromRow,
  externalActivitySummaryResult,
  externalActivityTransactionFromRow,
  extractRequestedIntent,
  isSameReviewExecution,
  normalizeExternalActivityLimit,
  normalizeListLimit,
  nullableSeconds,
  parseActionPlanEvidence,
  parseEvidenceJson,
  parseIsoTimestamp,
  parseOptionalIsoTimestamp,
  reasonForReviewState,
  reviewActivityListResult,
  reviewActivityRowFromStorage,
  reviewFunnelResult,
  reviewSessionWhere,
  serializeExternalActivityTransactionDetail,
  serializeJson,
  serializeOptionalJson
} from "./sqliteActivityStoreRows.js";

export { ActivityStoreError };
export type { SqliteActivityStoreOptions };

const ACTIVE_ACCOUNT_SINGLETON_ID = 1;
export const DATA_DIR_ENV = "SAY_UR_INTENT_DATA_DIR";
export const ACTIVITY_DATABASE_FILENAME = "say-ur-intent.sqlite";

// Best-effort permission hardening. The owner-only data directory is the primary
// protection; failures (e.g. on Windows, which ignores POSIX modes) are non-fatal.
function restrictPathPermissions(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Non-fatal: the 0700 directory remains the primary protection.
  }
}

export class SqliteActivityStore implements ActivityStore {
  private readonly db: SqliteDatabase;
  private readonly validateAdapterLifecycle: AdapterLifecycleValidator;

  constructor(options: SqliteActivityStoreOptions) {
    this.validateAdapterLifecycle = options.validateAdapterLifecycle;
    const dataDirectory = dirname(options.databasePath);
    try {
      mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    } catch {
      throw new ActivityStoreError(
        `Could not create the local activity data directory. Check directory permissions or set ${DATA_DIR_ENV}.`
      );
    }
    if (options.databasePath !== ":memory:" && existsSync(options.databasePath)) {
      const existing = new Database(options.databasePath, { readonly: true, fileMustExist: true });
      try { assertCurrentDatabaseFormat(existing); } finally { existing.close(); }
    }
    const database = new Database(options.databasePath);
    this.db = options.guardDatabase?.(database) ?? database;
    try {
      initializeDatabase(this.db);
      configureDatabase(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
    // This database persists unsigned transaction material (Option B), so restrict it to
    // the owner. The 0700 directory is the primary protection (it also covers the WAL/SHM
    // sidecars and blocks other OS users); the 0600 file is belt-and-suspenders. Best-effort
    // because some platforms (e.g. Windows) ignore POSIX modes.
    restrictPathPermissions(dataDirectory, 0o700);
    restrictPathPermissions(options.databasePath, 0o600);
  }

  async upsertAccount(address: string, source: AccountSource, now = new Date()): Promise<AccountRecord> {
    return this.upsertAccountSync(address, source, now.toISOString());
  }

  async getKnownAccount(address: string): Promise<AccountRecord | undefined> {
    const normalized = parseSuiAddress(address);
    if (!normalized) {
      throw new ActivityStoreReadError("input_invalid", "Invalid account address", { field: "account" });
    }
    return this.getAccountByAddressSync(normalized);
  }

  async setActiveAccount(
    address: string,
    source: "wallet_identity",
    now = new Date(),
    wallet?: { name?: string | undefined; id?: string | undefined }
  ): Promise<ActiveAccountRecord> {
    const timestamp = now.toISOString();
    return this.db.transaction(() => {
      const account = this.upsertAccountSync(address, source, timestamp);
      this.db
        .prepare(
          `INSERT INTO active_account_context (id, account_id, source, set_at, wallet_name, wallet_id)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             account_id = excluded.account_id,
             source = excluded.source,
             set_at = excluded.set_at,
             wallet_name = excluded.wallet_name,
             wallet_id = excluded.wallet_id`
        )
        .run(ACTIVE_ACCOUNT_SINGLETON_ID, account.id, source, timestamp, wallet?.name ?? null, wallet?.id ?? null);
      return {
        accountId: account.id,
        address: account.address,
        source,
        setAt: timestamp,
        ...(wallet?.name ? { walletName: wallet.name } : {}),
        ...(wallet?.id ? { walletId: wallet.id } : {})
      };
    })();
  }

  async getActiveAccount(): Promise<ActiveAccountRecord | undefined> {
    return this.getActiveAccountSync();
  }

  async clearActiveAccount(now = new Date()): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO active_account_context (id, account_id, source, set_at)
         VALUES (?, NULL, 'cleared', ?)
         ON CONFLICT(id) DO UPDATE SET
           account_id = NULL,
           source = 'cleared',
           set_at = excluded.set_at`
      )
      .run(ACTIVE_ACCOUNT_SINGLETON_ID, now.toISOString());
  }

  async recordReviewSession(input: ReviewSessionEvidenceInput): Promise<void> {
    const plan = parseActionPlanEvidence(input.plan);
    const planJson = serializeJson(plan);
    const intentJson = serializeOptionalJson(extractRequestedIntent(plan));
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `INSERT INTO review_sessions
               (id, plan_id, action_kind, adapter_id, protocol, current_status,
                plan_json, intent_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            input.reviewSessionId,
            plan.id,
            plan.actionKind,
            plan.adapterId,
            plan.protocol,
            input.currentStatus,
            planJson,
            intentJson,
            input.createdAt,
            input.createdAt
          );
        this.insertReviewTransition({
          reviewSessionId: input.reviewSessionId,
          event: "created",
          toStatus: input.currentStatus,
          transitionedAt: input.createdAt
        });
      })();
  }

  async recordReviewSessionWithLiveSession(
    input: ReviewSessionEvidenceInput,
    live: LiveReviewSessionMutation
  ): Promise<boolean> {
    const plan = parseActionPlanEvidence(input.plan);
    const planJson = serializeJson(plan);
    const intentJson = serializeOptionalJson(extractRequestedIntent(plan));
    return this.runLiveReviewSessionMutation(live, () => {
      this.db
        .prepare(
          `INSERT INTO review_sessions
             (id, plan_id, action_kind, adapter_id, protocol, current_status,
              plan_json, intent_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.reviewSessionId,
          plan.id,
          plan.actionKind,
          plan.adapterId,
          plan.protocol,
          input.currentStatus,
          planJson,
          intentJson,
          input.createdAt,
          input.createdAt
        );
      this.insertReviewTransition({
        reviewSessionId: input.reviewSessionId,
        event: "created",
        toStatus: input.currentStatus,
        transitionedAt: input.createdAt
      });
    });
  }

  async recordReviewTransition(input: ReviewTransitionInput): Promise<void> {
    this.db
      .transaction(() => {
        const accountId = input.account
          ? this.upsertAccountSync(input.account, "review_execution", input.transitionedAt).id
          : null;
        if (accountId !== null) {
          this.assertReviewSessionAccount(input.reviewSessionId, accountId);
        }
        this.insertReviewTransition({ ...input, accountId });
        this.db
          .prepare(
            `UPDATE review_sessions
             SET current_status = ?, account_id = COALESCE(account_id, ?), updated_at = ?
             WHERE id = ?`
          )
          .run(input.toStatus, accountId, input.transitionedAt, input.reviewSessionId);
      })();
  }

  async recordReviewTransitionWithLiveSession(
    input: ReviewTransitionInput,
    live: LiveReviewSessionMutation
  ): Promise<boolean> {
    return this.runLiveReviewSessionMutation(live, () => {
      const accountId = input.account
        ? this.upsertAccountSync(input.account, "review_execution", input.transitionedAt).id
        : null;
      if (accountId !== null) {
        this.assertReviewSessionAccount(input.reviewSessionId, accountId);
        if (input.event === "wallet_connected") {
          this.assertActiveAccountSync(accountId, input.reviewSessionId);
        }
      }
      this.insertReviewTransition({ ...input, accountId });
      this.db
        .prepare(
          `UPDATE review_sessions
           SET current_status = ?, account_id = COALESCE(account_id, ?), updated_at = ?
           WHERE id = ?`
        )
        .run(input.toStatus, accountId, input.transitionedAt, input.reviewSessionId);
    });
  }

  async recordReviewStateSnapshot(input: ReviewStateSnapshotInput): Promise<void> {
    const parsedState = parseLifecycleValidatedReviewState(input.state, this.validateAdapterLifecycle);
    const stateJson = serializeJson(parsedState);
    this.db
      .transaction(() => {
        const account = this.upsertAccountSync(parsedState.account, "review_execution", input.recordedAt);
        this.assertReviewSessionAccount(input.reviewSessionId, account.id);
        this.db
          .prepare(
            `INSERT INTO review_state_snapshots
               (review_session_id, plan_id, account_id, status, blocked_reason, refresh_reason,
                state_json, updated_at, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            input.reviewSessionId,
            parsedState.planId,
            account.id,
            parsedState.status,
            "blockedReason" in parsedState ? parsedState.blockedReason : null,
            "refreshReason" in parsedState ? parsedState.refreshReason : null,
            stateJson,
            parsedState.updatedAt,
            input.recordedAt
          );
        this.insertReviewTransition({
          reviewSessionId: input.reviewSessionId,
          event: "state_computed",
          fromStatus: input.fromStatus,
          toStatus: parsedState.status,
          accountId: account.id,
          reason: reasonForReviewState(parsedState),
          transitionedAt: input.recordedAt
        });
        this.db
          .prepare(
            `UPDATE review_sessions
             SET current_status = ?, account_id = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(parsedState.status, account.id, input.recordedAt, input.reviewSessionId);
      })();
  }

  async recordReviewStateSnapshotWithLiveSession(
    input: ReviewStateSnapshotInput,
    live: LiveReviewSessionMutation
  ): Promise<boolean> {
    const parsedState = parseLifecycleValidatedReviewState(input.state, this.validateAdapterLifecycle);
    const stateJson = serializeJson(parsedState);
    return this.runLiveReviewSessionMutation(live, () => {
      const account = this.upsertAccountSync(parsedState.account, "review_execution", input.recordedAt);
      this.assertReviewSessionAccount(input.reviewSessionId, account.id);
      this.db
        .prepare(
          `INSERT INTO review_state_snapshots
             (review_session_id, plan_id, account_id, status, blocked_reason, refresh_reason,
              state_json, updated_at, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.reviewSessionId,
          parsedState.planId,
          account.id,
          parsedState.status,
          "blockedReason" in parsedState ? parsedState.blockedReason : null,
          "refreshReason" in parsedState ? parsedState.refreshReason : null,
          stateJson,
          parsedState.updatedAt,
          input.recordedAt
        );
      this.insertReviewTransition({
        reviewSessionId: input.reviewSessionId,
        event: "state_computed",
        fromStatus: input.fromStatus,
        toStatus: parsedState.status,
        accountId: account.id,
        reason: reasonForReviewState(parsedState),
        transitionedAt: input.recordedAt
      });
      this.db
        .prepare(
          `UPDATE review_sessions
           SET current_status = ?, account_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(parsedState.status, account.id, input.recordedAt, input.reviewSessionId);
    });
  }

  async recordReviewExecution(input: ReviewExecutionInput): Promise<ReviewExecutionRecord> {
    const resultJson = serializeJson(input.result);
    this.db
      .transaction(() => {
        const account = this.upsertAccountSync(input.account, "review_execution", input.recordedAt);
        this.assertReviewSessionAccount(input.reviewSessionId, account.id);
        const existing = this.getReviewExecutionStorageRow(input.reviewSessionId);
        if (existing) {
          if (isSameReviewExecution(existing, account.id, input)) {
            return;
          }
          if (!canAdvanceReviewExecution(existing, account.id, input)) {
            throw new ActivityStoreError(`Conflicting review execution evidence: ${input.reviewSessionId}`);
          }
        }
        this.db
          .prepare(
            `INSERT INTO review_executions
               (review_session_id, plan_id, account_id, status, tx_digest, explorer_url,
                failure_reason, result_json, recorded_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(review_session_id) DO UPDATE SET
               plan_id = excluded.plan_id,
               account_id = excluded.account_id,
               status = excluded.status,
               tx_digest = excluded.tx_digest,
               explorer_url = excluded.explorer_url,
               failure_reason = excluded.failure_reason,
               result_json = excluded.result_json,
               updated_at = excluded.updated_at`
          )
          .run(
            input.reviewSessionId,
            input.planId,
            account.id,
            input.status,
            input.txDigest ?? null,
            input.explorerUrl ?? null,
            input.failureReason ?? null,
            resultJson,
            input.recordedAt,
            input.recordedAt
          );
        this.insertReviewTransition({
          reviewSessionId: input.reviewSessionId,
          event: "result_recorded",
          fromStatus: input.fromStatus,
          toStatus: input.status,
          accountId: account.id,
          reason: input.failureReason,
          transitionedAt: input.recordedAt
        });
        this.db
          .prepare(
            `UPDATE review_sessions
             SET current_status = ?, account_id = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(input.status, account.id, input.recordedAt, input.reviewSessionId);
      })();
    const recorded = await this.getReviewExecution(input.reviewSessionId);
    if (!recorded) {
      throw new ActivityStoreError(`Review execution was not recorded: ${input.reviewSessionId}`);
    }
    return recorded;
  }

  async recordReviewExecutionWithLiveSession(
    input: ReviewExecutionInput,
    live: LiveReviewSessionMutation
  ): Promise<ReviewExecutionRecord | undefined> {
    const resultJson = serializeJson(input.result);
    const committed = this.runLiveReviewSessionMutation(live, () => {
      const account = this.upsertAccountSync(input.account, "review_execution", input.recordedAt);
      this.assertReviewSessionAccount(input.reviewSessionId, account.id);
      const existing = this.getReviewExecutionStorageRow(input.reviewSessionId);
      if (existing) {
        if (isSameReviewExecution(existing, account.id, input)) {
          return;
        }
        if (!canAdvanceReviewExecution(existing, account.id, input)) {
          throw new ActivityStoreError(`Conflicting review execution evidence: ${input.reviewSessionId}`);
        }
      }
      this.db
        .prepare(
          `INSERT INTO review_executions
             (review_session_id, plan_id, account_id, status, tx_digest, explorer_url,
              failure_reason, result_json, recorded_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(review_session_id) DO UPDATE SET
             plan_id = excluded.plan_id,
             account_id = excluded.account_id,
             status = excluded.status,
             tx_digest = excluded.tx_digest,
             explorer_url = excluded.explorer_url,
             failure_reason = excluded.failure_reason,
             result_json = excluded.result_json,
             updated_at = excluded.updated_at`
        )
        .run(
          input.reviewSessionId,
          input.planId,
          account.id,
          input.status,
          input.txDigest ?? null,
          input.explorerUrl ?? null,
          input.failureReason ?? null,
          resultJson,
          input.recordedAt,
          input.recordedAt
        );
      this.insertReviewTransition({
        reviewSessionId: input.reviewSessionId,
        event: "result_recorded",
        fromStatus: input.fromStatus,
        toStatus: input.status,
        accountId: account.id,
        reason: input.failureReason,
        transitionedAt: input.recordedAt
      });
      this.db
        .prepare(
          `UPDATE review_sessions
           SET current_status = ?, account_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(input.status, account.id, input.recordedAt, input.reviewSessionId);
    });
    if (!committed) {
      return undefined;
    }
    const recorded = await this.getReviewExecution(input.reviewSessionId);
    if (!recorded) {
      throw new ActivityStoreError(`Review execution was not recorded: ${input.reviewSessionId}`);
    }
    return recorded;
  }

  private getReviewExecutionStorageRow(reviewSessionId: string): ReviewExecutionStorageRow | undefined {
    return this.db
      .prepare(
        `SELECT review_session_id, plan_id, account_id, status, tx_digest, explorer_url, failure_reason
         FROM review_executions
         WHERE review_session_id = ?`
      )
      .get(reviewSessionId) as ReviewExecutionStorageRow | undefined;
  }

  async getReviewExecution(reviewSessionId: string): Promise<ReviewExecutionRecord | undefined> {
    const row = this.db
      .prepare(
        `SELECT r.review_session_id, r.plan_id, r.account_id, a.sui_address AS account,
                r.status, r.tx_digest, r.explorer_url, r.failure_reason, r.recorded_at, r.updated_at
         FROM review_executions r
         JOIN accounts a ON a.id = r.account_id
         WHERE r.review_session_id = ?`
      )
      .get(reviewSessionId) as ReviewExecutionRow | undefined;
    return row
      ? {
          reviewSessionId: asString(row.review_session_id),
          planId: asString(row.plan_id),
          accountId: row.account_id,
          account: asString(row.account),
          status: asString(row.status),
          txDigest: row.tx_digest === null ? undefined : asString(row.tx_digest),
          explorerUrl: row.explorer_url === null ? undefined : asString(row.explorer_url),
          failureReason: row.failure_reason === null ? undefined : asString(row.failure_reason),
          recordedAt: asString(row.recorded_at),
          updatedAt: asString(row.updated_at)
        }
      : undefined;
  }

  async listReviewActivity(filter: ReviewActivityListFilter): Promise<ReviewActivityListResult> {
    const from = parseOptionalIsoTimestamp(filter.from, "from");
    const to = parseOptionalIsoTimestamp(filter.to, "to");
    assertDateRange(from, to);
    const limit = normalizeListLimit(filter.limit);
    const scope = this.resolveReviewActivityScope(filter);

    if (scope.accountId === undefined) {
      return reviewActivityListResult(scope, from, to, [], false, 0);
    }

    const { whereSql, params } = reviewSessionWhere(scope.accountId, from, to, filter.status);
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM review_sessions rs ${whereSql}`)
      .get(...params) as CountRow;
    const rows = this.db
      .prepare(
        `SELECT rs.id AS review_session_id, rs.plan_id, rs.action_kind, rs.adapter_id, rs.protocol,
                rs.current_status, a.sui_address AS account, rs.created_at, rs.updated_at,
                re.status AS execution_status, re.tx_digest,
                (SELECT COUNT(*) FROM review_state_snapshots s WHERE s.review_session_id = rs.id) AS snapshot_count,
                (SELECT COUNT(*) FROM review_status_transitions t WHERE t.review_session_id = rs.id) AS transition_count
         FROM review_sessions rs
         JOIN accounts a ON a.id = rs.account_id
         LEFT JOIN review_executions re ON re.review_session_id = rs.id
         ${whereSql}
         ORDER BY rs.created_at DESC, rs.id DESC
         LIMIT ?`
      )
      .all(...params, limit + 1) as ReviewActivityListRow[];
    const truncated = rows.length > limit;
    const activities = rows.slice(0, limit).map(reviewActivityRowFromStorage);
    return reviewActivityListResult(scope, from, to, activities, truncated, totalRow.count);
  }

  async summarizeReviewFunnel(filter: ReviewActivityFilter): Promise<ReviewFunnelSummaryResult> {
    const from = parseOptionalIsoTimestamp(filter.from, "from");
    const to = parseOptionalIsoTimestamp(filter.to, "to");
    assertDateRange(from, to);
    const scope = this.resolveReviewActivityScope(filter);

    if (scope.accountId === undefined) {
      return reviewFunnelResult(scope, from, to, emptyReviewFunnelSummary(), 0);
    }

    const { whereSql, params } = reviewSessionWhere(scope.accountId, from, to);
    const total = (this.db
      .prepare(`SELECT COUNT(*) AS count FROM review_sessions rs ${whereSql}`)
      .get(...params) as CountRow).count;
    const eventCounts = this.db
      .prepare(
        `SELECT t.event AS key, COUNT(DISTINCT t.review_session_id) AS count
         FROM review_status_transitions t
         JOIN review_sessions rs ON rs.id = t.review_session_id
         ${whereSql}
         GROUP BY t.event`
      )
      .all(...params) as KeyCountRow[];
    const currentStatusCounts = this.db
      .prepare(
        `SELECT rs.current_status AS key, COUNT(*) AS count
         FROM review_sessions rs
         ${whereSql}
         GROUP BY rs.current_status`
      )
      .all(...params) as KeyCountRow[];
    const reachedStateCounts = this.db
      .prepare(
        `SELECT t.to_status AS key, COUNT(DISTINCT t.review_session_id) AS count
         FROM review_status_transitions t
         JOIN review_sessions rs ON rs.id = t.review_session_id
         ${whereSql}
           AND t.to_status IN ('ready_for_wallet_review', 'blocked', 'refresh_required')
         GROUP BY t.to_status`
      )
      .all(...params) as KeyCountRow[];
    const signedPending = (this.db
      .prepare(
        `SELECT COUNT(DISTINCT t.review_session_id) AS count
         FROM review_status_transitions t
         JOIN review_sessions rs ON rs.id = t.review_session_id
         ${whereSql}
           AND t.event = 'result_recorded'
           AND t.to_status = 'signed_pending_result'`
      )
      .get(...params) as CountRow).count;
    const expiredBeforeResult = (this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM review_sessions rs
         LEFT JOIN review_executions re ON re.review_session_id = rs.id
         ${whereSql}
           AND rs.current_status = 'expired'
           AND re.review_session_id IS NULL`
      )
      .get(...params) as CountRow).count;
    const timing = this.db
      .prepare(
        `WITH scoped AS (
           SELECT rs.id, rs.created_at
           FROM review_sessions rs
           ${whereSql}
         ),
         signed AS (
           SELECT review_session_id, MIN(transitioned_at) AS signed_at
           FROM review_status_transitions
           WHERE event = 'result_recorded' AND to_status = 'signed_pending_result'
           GROUP BY review_session_id
         ),
         opened AS (
           SELECT review_session_id, MIN(transitioned_at) AS opened_at
           FROM review_status_transitions
           WHERE event = 'opened'
           GROUP BY review_session_id
         )
         SELECT
           AVG((julianday(signed.signed_at) - julianday(scoped.created_at)) * 86400.0) AS avg_created_to_signed,
           AVG(
             CASE
               WHEN opened.opened_at IS NULL THEN NULL
               ELSE (julianday(signed.signed_at) - julianday(opened.opened_at)) * 86400.0
             END
           ) AS avg_opened_to_signed
         FROM scoped
         JOIN signed ON signed.review_session_id = scoped.id
         LEFT JOIN opened ON opened.review_session_id = scoped.id`
      )
      .get(...params) as TimingRow;

    const currentStatus = countMap(INTERNAL_SESSION_STATUSES, currentStatusCounts);
    const reachedStates = countMap(REVIEW_STATE_STATUSES, reachedStateCounts);
    const events = countMap(REVIEW_TRANSITION_EVENTS, eventCounts);
    const summary: ReviewFunnelSummary = {
      total,
      opened: events.opened,
      walletConnected: events.wallet_connected,
      stateComputed: events.state_computed,
      currentStatusCounts: currentStatus,
      everReachedReviewStateCounts: reachedStates,
      signedPending,
      success: currentStatus.success,
      failure: currentStatus.failure,
      expiredBeforeResult,
      avgCreatedToSignedSeconds: nullableSeconds(timing.avg_created_to_signed),
      avgOpenedToSignedSeconds: nullableSeconds(timing.avg_opened_to_signed)
    };
    return reviewFunnelResult(scope, from, to, summary, total);
  }

  async getReviewSessionDetail(input: ReviewSessionDetailInput): Promise<ReviewSessionDetailResult> {
    const scope = this.resolveReviewActivityScope({ account: input.account });
    if (scope.accountId === undefined) {
      throw new ActivityStoreReadError("session_not_found", "Review session not found", {
        reviewSessionId: input.reviewSessionId
      });
    }
    const row = this.db
      .prepare(
        `SELECT rs.id AS review_session_id, rs.plan_id, rs.action_kind, rs.adapter_id, rs.protocol,
                rs.current_status, a.sui_address AS account, rs.created_at, rs.updated_at,
                rs.plan_json, rs.intent_json,
                re.status AS execution_status, re.tx_digest, re.explorer_url, re.failure_reason,
                re.recorded_at AS execution_recorded_at, re.updated_at AS execution_updated_at,
                re.result_json
         FROM review_sessions rs
         JOIN accounts a ON a.id = rs.account_id
         LEFT JOIN review_executions re ON re.review_session_id = rs.id
         WHERE rs.id = ? AND rs.account_id = ?`
      )
      .get(input.reviewSessionId, scope.accountId) as ReviewSessionDetailRow | undefined;
    if (!row) {
      throw new ActivityStoreReadError("session_not_found", "Review session not found", {
        reviewSessionId: input.reviewSessionId
      });
    }

    const snapshotRows = this.db
      .prepare(
        `SELECT s.id, s.plan_id, a.sui_address AS account, s.status, s.blocked_reason, s.refresh_reason,
                s.state_json, s.updated_at, s.recorded_at
         FROM review_state_snapshots s
         JOIN accounts a ON a.id = s.account_id
         WHERE s.review_session_id = ? AND s.account_id = ?
         ORDER BY s.recorded_at ASC, s.id ASC
         LIMIT ?`
      )
      .all(input.reviewSessionId, scope.accountId, REVIEW_ACTIVITY_DETAIL_MAX_ITEMS + 1) as ReviewStateSnapshotRow[];
    const transitionRows = this.db
      .prepare(
        `SELECT t.id, t.event, t.from_status, t.to_status, a.sui_address AS account,
                t.reason, t.transitioned_at
         FROM review_status_transitions t
         LEFT JOIN accounts a ON a.id = t.account_id
         WHERE t.review_session_id = ? AND (t.account_id IS NULL OR t.account_id = ?)
         ORDER BY t.transitioned_at ASC, t.id ASC
         LIMIT ?`
      )
      .all(input.reviewSessionId, scope.accountId, REVIEW_ACTIVITY_DETAIL_MAX_ITEMS + 1) as ReviewTransitionRow[];
    const recordCount = (this.db
      .prepare(`SELECT COUNT(*) AS count FROM review_sessions rs WHERE rs.account_id = ?`)
      .get(scope.accountId) as CountRow).count;

    const snapshotsTruncated = snapshotRows.length > REVIEW_ACTIVITY_DETAIL_MAX_ITEMS;
    const transitionsTruncated = transitionRows.length > REVIEW_ACTIVITY_DETAIL_MAX_ITEMS;
    const planJson = parseEvidenceJson<ActionPlan>(
      row.plan_json,
      input.reviewSessionId,
      "plan_json",
      actionPlanSchema
    );
    const intentJson = row.intent_json === null
      ? undefined
      : parseEvidenceJson<unknown>(row.intent_json, input.reviewSessionId, "intent_json");
    const execution = row.execution_status === null
      ? undefined
      : {
          reviewSessionId: asString(row.review_session_id),
          planId: asString(row.plan_id),
          accountId: scope.accountId,
          account: asString(row.account),
          status: asString(row.execution_status),
          txDigest: row.tx_digest === null ? undefined : asString(row.tx_digest),
          explorerUrl: row.explorer_url === null ? undefined : asString(row.explorer_url),
          failureReason: row.failure_reason === null ? undefined : asString(row.failure_reason),
          recordedAt: asString(row.execution_recorded_at),
          updatedAt: asString(row.execution_updated_at),
          resultJson: parseEvidenceJson<ExecutionResult>(
            row.result_json,
            input.reviewSessionId,
            "result_json",
            executionResultSchema
          )
        };

    return {
      dataScope: {
        account: scope.account,
        recordCount
      },
      accountSource: scope.accountSource,
      lowSampleWarning: recordCount < REVIEW_ACTIVITY_LOW_SAMPLE_THRESHOLD,
      lowSampleThreshold: REVIEW_ACTIVITY_LOW_SAMPLE_THRESHOLD,
      session: {
        reviewSessionId: asString(row.review_session_id),
        planId: asString(row.plan_id),
        actionKind: asString(row.action_kind),
        adapterId: asString(row.adapter_id),
        protocol: asString(row.protocol),
        currentStatus: asInternalSessionStatus(row.current_status),
        account: asString(row.account),
        createdAt: asString(row.created_at),
        updatedAt: asString(row.updated_at)
      },
      planJson,
      intentJson,
      stateSnapshots: snapshotRows.slice(0, REVIEW_ACTIVITY_DETAIL_MAX_ITEMS).map((snapshot) => ({
        id: snapshot.id,
        planId: asString(snapshot.plan_id),
        account: asString(snapshot.account),
        status: asString(snapshot.status),
        blockedReason: snapshot.blocked_reason === null ? undefined : asString(snapshot.blocked_reason),
        refreshReason: snapshot.refresh_reason === null ? undefined : asString(snapshot.refresh_reason),
        stateJson: this.parseReviewStateEvidenceJson(
          snapshot.state_json,
          input.reviewSessionId,
          "state_json"
        ),
        updatedAt: asString(snapshot.updated_at),
        recordedAt: asString(snapshot.recorded_at)
      })),
      transitions: transitionRows.slice(0, REVIEW_ACTIVITY_DETAIL_MAX_ITEMS).map((transitionRow) => ({
        id: transitionRow.id,
        event: asReviewTransitionEvent(transitionRow.event),
        fromStatus: transitionRow.from_status === null ? undefined : asString(transitionRow.from_status),
        toStatus: asString(transitionRow.to_status),
        isNoOp: transitionRow.from_status !== null && asString(transitionRow.from_status) === asString(transitionRow.to_status),
        account: transitionRow.account === null ? undefined : asString(transitionRow.account),
        reason: transitionRow.reason === null ? undefined : asString(transitionRow.reason),
        transitionedAt: asString(transitionRow.transitioned_at)
      })),
      execution,
      truncated: {
        activities: false,
        snapshots: snapshotsTruncated,
        transitions: transitionsTruncated
      }
    };
  }

  async recordExternalActivityScan(input: ExternalActivityScanInput): Promise<ExternalActivityScanRecord> {
    try {
      assertNoForbiddenMcpFields(input);
    } catch {
      throw new ActivityStoreReadError("input_invalid", "External activity scan contains forbidden fields", {
        reason: "forbidden_field"
      });
    }
    const account = await this.getKnownAccount(input.account);
    if (!account) {
      throw new ActivityStoreReadError("input_invalid", "External activity scan account is not a known wallet", {
        reason: "account_not_known"
      });
    }
    const fetchedAt = parseIsoTimestamp(input.fetchedAt, "fetchedAt");
    const fromTimestamp = parseOptionalIsoTimestamp(input.fromTimestamp, "from");
    const toTimestamp = parseOptionalIsoTimestamp(input.toTimestamp, "to");
    assertDateRange(fromTimestamp, toTimestamp);
    const record = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO external_activity_scans
             (scan_id, kind, account_id, relationship, input_digest, from_checkpoint, to_checkpoint,
              from_timestamp, to_timestamp, limit_count, request_cursor, response_cursor, endpoint_host,
              chain_identifier, fetched_at, stored_count, skipped_count, has_more, window_complete,
              incomplete_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.scanId,
          input.kind,
          account.id,
          input.relationship,
          input.inputDigest ?? null,
          input.fromCheckpoint ?? null,
          input.toCheckpoint ?? null,
          fromTimestamp ?? null,
          toTimestamp ?? null,
          input.limit,
          input.requestCursor ?? null,
          input.responseCursor ?? null,
          input.endpointHost,
          input.chainIdentifier,
          fetchedAt,
          0,
          input.transactions.length,
          input.hasMore ? 1 : 0,
          input.windowComplete === null ? null : input.windowComplete ? 1 : 0,
          input.incompleteReason ?? null
        );

      let storedCount = 0;
      const skippedCount = input.skippedCount ?? 0;
      const upsert = this.db.prepare(
        `INSERT INTO external_activity_transactions
           (account_id, digest, relationship, checkpoint, timestamp, status, known_sender_account_id,
            first_scan_id, last_scan_id, first_fetched_at, last_fetched_at, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, digest, relationship) DO UPDATE SET
           checkpoint = COALESCE(excluded.checkpoint, external_activity_transactions.checkpoint),
           timestamp = COALESCE(excluded.timestamp, external_activity_transactions.timestamp),
           status = excluded.status,
           known_sender_account_id = COALESCE(excluded.known_sender_account_id, external_activity_transactions.known_sender_account_id),
           last_scan_id = excluded.last_scan_id,
           last_fetched_at = excluded.last_fetched_at,
           detail_json = COALESCE(excluded.detail_json, external_activity_transactions.detail_json)`
      );
      for (const transaction of input.transactions) {
        if (transaction.knownSenderAccountId !== undefined && !this.accountIdExists(transaction.knownSenderAccountId)) {
          throw new ActivityStoreReadError("input_invalid", "External activity sender account is not known", {
            reason: "sender_account_not_known"
          });
        }
        upsert.run(
          account.id,
          transaction.digest,
          transaction.relationship,
          transaction.checkpoint ?? null,
          transaction.timestamp ? parseIsoTimestamp(transaction.timestamp, "transaction.timestamp") : null,
          transaction.status,
          transaction.knownSenderAccountId ?? null,
          input.scanId,
          input.scanId,
          fetchedAt,
          fetchedAt,
          transaction.details === undefined
            ? null
            : serializeExternalActivityTransactionDetail(transaction.details, account.address)
        );
        storedCount += 1;
      }
      this.db
        .prepare(
          `UPDATE external_activity_scans
           SET stored_count = ?, skipped_count = ?
           WHERE scan_id = ?`
        )
        .run(storedCount, skippedCount + input.transactions.length - storedCount, input.scanId);
      return this.externalActivityScanById(input.scanId);
    })();
    if (!record) {
      throw new ActivityStoreReadError("internal_error", "External activity scan was not recorded", {
        scanId: input.scanId
      });
    }
    return record;
  }

  async getExternalActivityCoverage(filter: ExternalActivityCoverageFilter): Promise<ExternalActivityCoverageResult> {
    const from = parseIsoTimestamp(filter.from, "from");
    const to = parseIsoTimestamp(filter.to, "to");
    assertDateRange(from, to);
    assertNonEmptyHalfOpenRange(from, to);
    const scope = this.resolveReviewActivityScope(filter);

    if (scope.accountId === undefined) {
      return buildExternalActivityCoverageResult({
        scope,
        from,
        to,
        scans: [],
        scanCount: 0,
        storedTransactionCount: 0
      });
    }

    const scanWhereSql = `
      WHERE eas.account_id = ?
        AND (eas.from_timestamp IS NULL OR eas.from_timestamp < ?)
        AND (eas.to_timestamp IS NULL OR eas.to_timestamp > ?)`;
    const scanParams = [scope.accountId, to, from] as const;
    const scanCount = (this.db
      .prepare(`SELECT COUNT(*) AS count FROM external_activity_scans eas ${scanWhereSql}`)
      .get(...scanParams) as CountRow).count;
    const scanRows = this.db
      .prepare(
        `SELECT eas.scan_id, eas.kind, eas.account_id, a.sui_address AS account, eas.relationship,
                eas.input_digest, eas.from_checkpoint, eas.to_checkpoint, eas.from_timestamp,
                eas.to_timestamp, eas.limit_count, eas.request_cursor, eas.response_cursor,
                eas.endpoint_host, eas.chain_identifier, eas.fetched_at, eas.stored_count,
                eas.skipped_count, eas.has_more, eas.window_complete, eas.incomplete_reason
         FROM external_activity_scans eas
         JOIN accounts a ON a.id = eas.account_id
         ${scanWhereSql}
         ORDER BY eas.fetched_at DESC, eas.scan_id DESC
         LIMIT ?`
      )
      .all(...scanParams, EXTERNAL_ACTIVITY_COVERAGE_SCAN_MAX_RECORDS + 1) as ExternalActivityScanRow[];
    const scansTruncated = scanRows.length > EXTERNAL_ACTIVITY_COVERAGE_SCAN_MAX_RECORDS;
    const scans = scanRows
      .slice(0, EXTERNAL_ACTIVITY_COVERAGE_SCAN_MAX_RECORDS)
      .map(externalActivityScanFromRow);

    const transactionWhereSql = "WHERE eat.account_id = ? AND eat.timestamp >= ? AND eat.timestamp < ?";
    const transactionParams = [scope.accountId, from, to] as const;
    const canonicalTransactions = canonicalExternalActivityTransactions(this.externalActivityTransactions(transactionWhereSql, [...transactionParams]));
    const storedTransactionCount = canonicalTransactions.length;
    const storedTransactionRange = canonicalTransactions.length === 0
      ? undefined
      : externalActivityTransactionRangeFromRecords(canonicalTransactions);

    return buildExternalActivityCoverageResult({
      scope,
      from,
      to,
      scans,
      scanCount,
      storedTransactionCount,
      storedTransactionRange,
      scansTruncated
    });
  }

  async listExternalActivityEffectTransactions(
    filter: ExternalActivityTransactionStreamFilter
  ): Promise<ExternalActivityTransactionStreamResult> {
    const from = parseIsoTimestamp(filter.from, "from");
    const to = parseIsoTimestamp(filter.to, "to");
    assertDateRange(from, to);
    assertNonEmptyHalfOpenRange(from, to);
    const limit = normalizeExternalActivityLimit(filter.limit);
    const scope = this.resolveReviewActivityScope(filter);

    if (scope.accountId === undefined) {
      return buildExternalActivityTransactionStreamResult({
        scope,
        from,
        to,
        transactions: [],
        truncated: false,
        transactionCount: 0
      });
    }

    const whereSql = "WHERE eat.account_id = ? AND eat.timestamp >= ? AND eat.timestamp < ?";
    const canonicalTransactions = canonicalExternalActivityTransactions(
      this.externalActivityTransactions(whereSql, [scope.accountId, from, to])
    );

    return buildExternalActivityTransactionStreamResult({
      scope,
      from,
      to,
      transactions: canonicalTransactions.slice(0, limit),
      truncated: canonicalTransactions.length > limit,
      transactionCount: canonicalTransactions.length
    });
  }

  async summarizeExternalActivity(filter: ExternalActivitySummaryFilter): Promise<ExternalActivitySummaryResult> {
    const from = parseOptionalIsoTimestamp(filter.from, "from");
    const to = parseOptionalIsoTimestamp(filter.to, "to");
    assertDateRange(from, to);
    const limit = normalizeExternalActivityLimit(filter.limit);
    const scope = this.resolveReviewActivityScope(filter);

    if (scope.accountId === undefined) {
      return externalActivitySummaryResult(scope, from, to, [], false, emptyExternalActivitySummaryStats());
    }

    const where: string[] = ["eat.account_id = ?"];
    const params: unknown[] = [scope.accountId];
    if (from !== undefined) {
      where.push("eat.timestamp >= ?");
      params.push(from);
    }
    if (to !== undefined) {
      where.push("eat.timestamp <= ?");
      params.push(to);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const total = (this.db
      .prepare(`SELECT COUNT(*) AS count FROM external_activity_transactions eat ${whereSql}`)
      .get(...params) as CountRow).count;
    const statusCounts = countMap(
      EXTERNAL_ACTIVITY_STATUSES,
      this.db
        .prepare(`SELECT eat.status AS key, COUNT(*) AS count FROM external_activity_transactions eat ${whereSql} GROUP BY eat.status`)
        .all(...params) as KeyCountRow[]
    );
    const relationshipCounts = countMap(
      EXTERNAL_ACTIVITY_RELATIONSHIPS,
      this.db
        .prepare(`SELECT eat.relationship AS key, COUNT(*) AS count FROM external_activity_transactions eat ${whereSql} GROUP BY eat.relationship`)
        .all(...params) as KeyCountRow[]
    );
    const timestampRow = this.db
      .prepare(
        `SELECT MIN(eat.timestamp) AS earliest_timestamp, MAX(eat.timestamp) AS latest_timestamp
         FROM external_activity_transactions eat
         ${whereSql}`
      )
      .get(...params) as { earliest_timestamp: string | null; latest_timestamp: string | null };
    const rows = this.db
      .prepare(
        `SELECT eat.account_id, a.sui_address AS account, eat.digest, eat.relationship,
                eat.checkpoint, eat.timestamp, eat.status, eat.known_sender_account_id,
                eat.first_scan_id, eat.last_scan_id, eat.first_fetched_at, eat.last_fetched_at,
                last_scan.incomplete_reason AS last_scan_incomplete_reason,
                eat.detail_json
         FROM external_activity_transactions eat
         JOIN accounts a ON a.id = eat.account_id
         LEFT JOIN external_activity_scans last_scan ON last_scan.scan_id = eat.last_scan_id
         ${whereSql}
         ORDER BY
           CASE WHEN eat.checkpoint IS NULL THEN 0 ELSE 1 END DESC,
           CAST(eat.checkpoint AS INTEGER) DESC,
           COALESCE(eat.timestamp, '') DESC,
           eat.digest DESC
         LIMIT ?`
      )
      .all(...params, limit + 1) as ExternalActivityTransactionRow[];
    return externalActivitySummaryResult(
      scope,
      from,
      to,
      rows.slice(0, limit).map(externalActivityTransactionFromRow),
      rows.length > limit,
      {
        transactionCount: total,
        statusCounts,
        relationshipCounts,
        earliestTimestamp: timestampRow.earliest_timestamp ?? undefined,
        latestTimestamp: timestampRow.latest_timestamp ?? undefined
      }
    );
  }

  close(): void {
    this.db.close();
  }

  createPreferencesRepository(): SqlitePreferencesRepository {
    return new SqlitePreferencesRepository(this.db);
  }

  createLocalDataService(options: SqliteLocalDataServiceOptions): SqliteLocalDataService {
    return new SqliteLocalDataService(this.db, options, this.validateAdapterLifecycle);
  }

  createCoinMetadataCache(): CoinMetadataCache {
    return new SqliteCoinMetadataCache(this.db);
  }

  createTransactionMaterialStore(): LocalTransactionMaterialStore {
    return new SqliteTransactionMaterialStore(this.db);
  }

  createSessionRecordStore(): SessionRecordStore {
    return new SqliteSessionRecordStore(this.db, { usesActivityStoreLiveSessionMutations: true });
  }

  createCardRecordStore(): SqliteCardRecordStore {
    return new SqliteCardRecordStore(this.db);
  }

  createPrivateReviewArtifactStore(): PrivateReviewArtifactStore {
    return new SqlitePrivateReviewArtifactStore(this.db);
  }

  createWalletIdentityRecordStore(): KeyedRecordStore<WalletIdentitySession> {
    return createSqliteWalletIdentityRecordStore(this.db);
  }

  createSettingsRecordStore(): KeyedRecordStore<SettingsSession> {
    return createSqliteSettingsRecordStore(this.db);
  }

  private runLiveReviewSessionMutation(
    live: LiveReviewSessionMutation,
    writeActivity: () => void
  ): boolean {
    const stale = new Error("live review session changed before commit");
    try {
      const commit = this.db.transaction(() => {
        writeActivity();
        if (!this.applyLiveReviewSessionMutation(live)) {
          throw stale;
        }
      });
      commit.immediate();
      return true;
    } catch (error) {
      if (error === stale) {
        return false;
      }
      throw error;
    }
  }

  private applyLiveReviewSessionMutation(live: LiveReviewSessionMutation): boolean {
    if (!live.expected) {
      if (this.liveReviewSessionRow(live.next.id)) {
        return false;
      }
      insertLiveReviewSessionRow(this.db, live.next);
      this.applyLiveReviewSessionSideEffects(live);
      return true;
    }

    const row = this.liveReviewSessionRow(live.next.id);
    if (!row || !isDeepStrictEqual(sessionFromLiveReviewSessionRow(row), live.expected)) {
      return false;
    }
    if (!updateLiveReviewSessionRow(this.db, row.revision, live.next)) {
      return false;
    }
    this.applyLiveReviewSessionSideEffects(live);
    return true;
  }

  private applyLiveReviewSessionSideEffects(live: LiveReviewSessionMutation): void {
    if (live.deleteTransactionMaterials) {
      this.db.prepare(`DELETE FROM live_transaction_materials WHERE review_session_id = ?`).run(live.next.id);
      this.db.prepare(`DELETE FROM live_private_review_artifacts WHERE review_session_id = ?`).run(live.next.id);
    }
    if (live.privateArtifactsJson === null) {
      this.db.prepare(`DELETE FROM live_private_review_artifacts WHERE review_session_id = ?`).run(live.next.id);
    } else if (live.privateArtifactsJson !== undefined) {
      this.db
        .prepare(
          `INSERT INTO live_private_review_artifacts (review_session_id, artifacts_json)
           VALUES (?, ?)
           ON CONFLICT(review_session_id) DO UPDATE SET artifacts_json = excluded.artifacts_json`
        )
        .run(live.next.id, live.privateArtifactsJson);
    }
  }

  private liveReviewSessionRow(id: string): LiveReviewSessionRow | undefined {
    return this.db
      .prepare(`SELECT * FROM live_review_sessions WHERE id = ?`)
      .get(id) as LiveReviewSessionRow | undefined;
  }

  private upsertAccountSync(address: string, source: AccountSource, timestamp: string): AccountRecord {
    const normalized = parseSuiAddress(address);
    if (!normalized) {
      throw new ActivityStoreError("Invalid Sui account address");
    }
    this.db
      .prepare(
        `INSERT INTO accounts (sui_address, first_seen_at, last_used_at, first_source, last_source)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sui_address) DO UPDATE SET
           last_used_at = excluded.last_used_at,
           last_source = excluded.last_source`
      )
      .run(normalized, timestamp, timestamp, source, source);
    const row = this.db
      .prepare(
        `SELECT id, sui_address, first_seen_at, last_used_at, first_source, last_source
         FROM accounts
         WHERE sui_address = ?`
      )
      .get(normalized) as AccountRow | undefined;
    if (!row) {
      throw new ActivityStoreError(`Account was not recorded: ${normalized}`);
    }
    return {
      id: row.id,
      address: asString(row.sui_address),
      firstSeenAt: asString(row.first_seen_at),
      lastUsedAt: asString(row.last_used_at),
      firstSource: asAccountSource(row.first_source),
      lastSource: asAccountSource(row.last_source)
    };
  }

  private parseReviewStateEvidenceJson(
    value: string | null,
    reviewSessionId: string,
    evidenceField: string
  ): ReviewState {
    const parsed = parseEvidenceJson<ReviewState>(
      value,
      reviewSessionId,
      evidenceField
    );
    try {
      return parseLifecycleValidatedReviewState(parsed, this.validateAdapterLifecycle);
    } catch {
      throw new ActivityStoreReadError("internal_error", "Malformed activity JSON evidence", {
        reviewSessionId,
        evidenceField
      });
    }
  }

  private getAccountByAddressSync(address: string): AccountRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, sui_address, first_seen_at, last_used_at, first_source, last_source
         FROM accounts
         WHERE sui_address = ?`
      )
      .get(address) as AccountRow | undefined;
    return row
      ? {
          id: row.id,
          address: asString(row.sui_address),
          firstSeenAt: asString(row.first_seen_at),
          lastUsedAt: asString(row.last_used_at),
          firstSource: asAccountSource(row.first_source),
          lastSource: asAccountSource(row.last_source)
        }
      : undefined;
  }

  private accountIdExists(accountId: number): boolean {
    const row = this.db.prepare("SELECT id FROM accounts WHERE id = ?").get(accountId) as { id: number } | undefined;
    return row !== undefined;
  }

  private externalActivityScanById(scanId: string): ExternalActivityScanRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT eas.scan_id, eas.kind, eas.account_id, a.sui_address AS account, eas.relationship,
                eas.input_digest, eas.from_checkpoint, eas.to_checkpoint, eas.from_timestamp,
                eas.to_timestamp, eas.limit_count, eas.request_cursor, eas.response_cursor,
                eas.endpoint_host, eas.chain_identifier, eas.fetched_at, eas.stored_count,
                eas.skipped_count, eas.has_more, eas.window_complete, eas.incomplete_reason
         FROM external_activity_scans eas
         JOIN accounts a ON a.id = eas.account_id
         WHERE eas.scan_id = ?`
      )
      .get(scanId) as ExternalActivityScanRow | undefined;
    return row ? externalActivityScanFromRow(row) : undefined;
  }

  private externalActivityTransactions(
    whereSql: string,
    params: unknown[]
  ): ExternalActivityTransactionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT eat.account_id, a.sui_address AS account, eat.digest, eat.relationship,
                eat.checkpoint, eat.timestamp, eat.status, eat.known_sender_account_id,
                eat.first_scan_id, eat.last_scan_id, eat.first_fetched_at, eat.last_fetched_at,
                last_scan.incomplete_reason AS last_scan_incomplete_reason,
                eat.detail_json
         FROM external_activity_transactions eat
         JOIN accounts a ON a.id = eat.account_id
         LEFT JOIN external_activity_scans last_scan ON last_scan.scan_id = eat.last_scan_id
         ${whereSql}
         ORDER BY
           CASE WHEN eat.checkpoint IS NULL THEN 0 ELSE 1 END DESC,
           CAST(eat.checkpoint AS INTEGER) DESC,
           COALESCE(eat.timestamp, '') DESC,
           eat.digest DESC`
      )
      .all(...params) as ExternalActivityTransactionRow[];
    return rows.map(externalActivityTransactionFromRow);
  }

  private insertReviewTransition(input: ReviewTransitionInput & { accountId?: number | null }): void {
    this.db
      .prepare(
        `INSERT INTO review_status_transitions
           (review_session_id, event, from_status, to_status, account_id, reason, transitioned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.reviewSessionId,
        input.event,
        input.fromStatus ?? null,
        input.toStatus,
        input.accountId ?? null,
        input.reason ?? null,
        input.transitionedAt
      );
  }

  private resolveReviewActivityScope(filter: ReviewActivityFilter): ReviewActivityScope {
    if (filter.account) {
      const normalized = parseSuiAddress(filter.account);
      if (!normalized) {
        throw new ActivityStoreReadError("input_invalid", "Invalid account filter", { field: "account" });
      }
      const row = this.db
        .prepare("SELECT id FROM accounts WHERE sui_address = ?")
        .get(normalized) as { id: number } | undefined;
      return {
        account: normalized,
        accountId: row?.id,
        accountSource: "explicit_filter"
      };
    }

    const active = this.getActiveAccountSync();
    if (!active) {
      throw new ActivityStoreReadError("active_account_not_set", "Active account read context is not set", {
        action: "connect_wallet_identity"
      });
    }
    return {
      account: active.address,
      accountId: active.accountId,
      accountSource: "active_account_context"
    };
  }

  private getActiveAccountSync(): ActiveAccountRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT a.id AS account_id, a.sui_address AS address, c.source AS source, c.set_at AS set_at,
                c.wallet_name AS wallet_name, c.wallet_id AS wallet_id
         FROM active_account_context c
         JOIN accounts a ON a.id = c.account_id
         WHERE c.id = ? AND c.account_id IS NOT NULL`
      )
      .get(ACTIVE_ACCOUNT_SINGLETON_ID) as ActiveAccountRow | undefined;
    return row
      ? {
          accountId: row.account_id,
          address: asString(row.address),
          source: "wallet_identity",
          setAt: asString(row.set_at),
          ...(row.wallet_name ? { walletName: row.wallet_name } : {}),
          ...(row.wallet_id ? { walletId: row.wallet_id } : {})
        }
      : undefined;
  }

  private assertReviewSessionAccount(reviewSessionId: string, accountId: number): void {
    const row = this.db
      .prepare("SELECT account_id FROM review_sessions WHERE id = ?")
      .get(reviewSessionId) as { account_id: number | null } | undefined;
    if (!row) {
      throw new ActivityStoreError(`Review session not found: ${reviewSessionId}`);
    }
    if (row.account_id !== null && row.account_id !== accountId) {
      throw new ActivityStoreError(`Review session already belongs to a different account: ${reviewSessionId}`);
    }
  }

  private assertActiveAccountSync(accountId: number, reviewSessionId: string): void {
    const row = this.db
      .prepare("SELECT account_id FROM active_account_context WHERE id = ? AND source = 'wallet_identity'")
      .get(ACTIVE_ACCOUNT_SINGLETON_ID) as { account_id: number | null } | undefined;
    if (!row || row.account_id !== accountId) {
      throw new ActivityStoreError(`Review session active account changed before commit: ${reviewSessionId}`);
    }
  }
}

function assertNonEmptyHalfOpenRange(from: string, to: string): void {
  if (from >= to) {
    throw new ActivityStoreReadError("input_invalid", "from must be before to for a non-empty half-open range", {
      from,
      to
    });
  }
}

function externalActivityTransactionRangeFromRecords(
  rows: ExternalActivityTransactionRecord[]
): NonNullable<ExternalActivityCoverageResult["storedTransactionRange"]> {
  const timestamps = rows.flatMap((row) => row.timestamp ?? []).sort();
  const checkpoints = rows.flatMap((row) => row.checkpoint ?? []).sort(compareIntegerStrings);
  return {
    earliestTimestamp: timestamps[0],
    latestTimestamp: timestamps.at(-1),
    earliestCheckpoint: checkpoints[0],
    latestCheckpoint: checkpoints.at(-1)
  };
}

function compareIntegerStrings(a: string, b: string): number {
  const delta = BigInt(a) - BigInt(b);
  if (delta < 0n) return -1;
  if (delta > 0n) return 1;
  return 0;
}

class SqliteCoinMetadataCache implements CoinMetadataCache {
  constructor(private readonly db: SqliteDatabase) {}

  async getCoinMetadata(input: {
    coinType: string;
    chainIdentifier: string;
    now: Date;
  }): Promise<CoinMetadataCacheLookup> {
    const row = this.db
      .prepare(
        `SELECT coin_type, chain_identifier, decimals, symbol, name, fetched_at, expires_at
         FROM coin_metadata_cache
         WHERE coin_type = ? AND chain_identifier = ?`
      )
      .get(input.coinType, input.chainIdentifier) as CoinMetadataCacheRow | undefined;
    if (!row) {
      return { status: "miss" };
    }
    const record = coinMetadataCacheRecordFromRow(row);
    return record.expiresAt > input.now.toISOString()
      ? { status: "hit", record }
      : { status: "expired", record };
  }

  async setCoinMetadata(record: CoinMetadataCacheRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO coin_metadata_cache
           (coin_type, chain_identifier, decimals, symbol, name, fetched_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(coin_type, chain_identifier) DO UPDATE SET
           decimals = excluded.decimals,
           symbol = excluded.symbol,
           name = excluded.name,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at`
      )
      .run(
        record.coinType,
        record.chainIdentifier,
        record.decimals,
        record.symbol,
        record.name,
        record.fetchedAt,
        record.expiresAt
      );
  }
}

export function resolveActivityDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const configured = env[DATA_DIR_ENV];
  const dataDir = configured && configured.trim() ? configured : defaultDataDir(env, platform);
  if (dataDir.includes("\0")) {
    throw new ActivityStoreError(`${DATA_DIR_ENV} must not contain null bytes`);
  }
  return resolve(dataDir, ACTIVITY_DATABASE_FILENAME);
}

export function assertSqliteEngineAvailable(): void {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE engine_check (id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO engine_check (id) VALUES (?)").run(1);
    const row = db.prepare("SELECT id FROM engine_check").get() as { id: number } | undefined;
    if (row?.id !== 1) {
      throw new ActivityStoreError("better-sqlite3 smoke query failed");
    }
  } finally {
    db.close();
  }
}

function defaultDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const home = homedir();
  if (platform === "darwin") {
    return resolve(home, "Library", "Application Support", "say-ur-intent");
  }
  if (platform === "win32") {
    return resolve(env.APPDATA ?? resolve(home, "AppData", "Roaming"), "say-ur-intent");
  }
  return resolve(env.XDG_DATA_HOME ?? resolve(home, ".local", "share"), "say-ur-intent");
}
