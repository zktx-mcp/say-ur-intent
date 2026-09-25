import type { EvaluatedWorkflowState } from "./workflowState.js";
import { SessionStoreError } from "./sessionErrors.js";
import { Transaction } from "@mysten/sui/transactions";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import { isDeepStrictEqual } from "node:util";
import type { ReviewComputationDeps } from "../review/reviewComputation.js";
import { computeReviewStateWithPrivateArtifacts } from "../review/reviewComputation.js";
import { assertNoForbiddenMcpFields } from "../action/forbiddenFields.js";
import type { PublicChainReceiptResult } from "../action/suiChainReceiptReader.js";
import { projectReadCardResult } from "../read/readCardResult.js";
import type { VerifySuiChainReceiptInput, SuiChainReceiptVerificationResult } from "../action/suiChainReceiptVerifier.js";
import type { SessionStore } from "./sessionStore.js";
import type { CardRecord, CardPreparation, ReceiptDisplay, WalletDisplay } from "./cardSession.js";
import { SqliteWalletWorkflowStore, WorkflowConflict } from "./sqliteWalletWorkflowStore.js";
import { isOwnedConnectedWallet, SUI_SIGN_TRANSACTION_METHOD, WalletUserRejectedError, WalletUnavailableError, walletUnavailable,
  type WalletStartupFailure, type WalletTransport, type WalletSession, type WalletAvailability, type WalletUnavailableReason, type WorkflowProgress } from "./walletConnection.js";
import { isInitialChainObservation, type TransactionRequest } from "./transactionRequest.js";
import { projectConnectionView, projectReviewView, parseWorkflowAction, type WorkflowView, type PendingConnectionStatus } from "./workflowView.js";

import { reviewProgress, type ReviewSnapshot } from "./status.js";

export class WalletWorkflow {
  private stopped = false;
  private started = false;
  private walletReady = false;
  private walletFailure: WalletUnavailableReason | undefined;
  private transportStopped = false;
  private readonly pairings = new Map<string, WalletDisplay>();
  private readonly observing = new Map<string, Promise<void>>();
  private readonly preparing = new Set<string>();
  private unsubscribe: (() => void) | undefined;
  constructor(private readonly options: {
    records: SqliteWalletWorkflowStore;
    sessions: SessionStore; ownerId: string;
    transport?: WalletTransport | undefined;
    startupFailure?: WalletStartupFailure | undefined;
    computation: ReviewComputationDeps;
    verifyReceipt(input: VerifySuiChainReceiptInput): Promise<SuiChainReceiptVerificationResult>;
    readReceipt?: ((input: { digest: string; now: Date }) => Promise<PublicChainReceiptResult>) | undefined;
    submitTransaction(bytes: Uint8Array, signature: string): Promise<unknown>;
    assertCurrent(): void;
    runExternalEvent?: ((work: () => void) => void) | undefined;
    verifyNetwork(): Promise<void>;
    signatureClient?: ClientWithCoreApi;
    logger: { error(message: string, meta?: Record<string, unknown>): void };
    now?: (() => Date) | undefined;
  }) {}

  private now(): Date { return this.options.now?.() ?? new Date(); }
  private assertCurrent(): void {
    if (this.stopped) throw new Error("Wallet workflow owner stopped.");
    this.options.assertCurrent();
  }
  walletAvailability(): WalletAvailability {
    this.assertCurrent();
    return this.walletReady && !this.walletFailure ? { status: "available" } :
      walletUnavailable(this.walletFailure ?? this.options.startupFailure ?? "initialization_failed");
  }
  private assertWalletAvailable(): void {
    const availability = this.walletAvailability();
    if (availability.status === "unavailable") throw new WalletUnavailableError(availability.reason);
  }
  private disableWallet(reason: WalletUnavailableReason): void {
    this.walletFailure ??= reason;
    this.walletReady = false;
    this.releaseWallet();
  }
  private releaseWallet(): void {
    if (this.transportStopped) return;
    this.transportStopped = true;
    this.pairings.clear();
    try { this.unsubscribe?.(); } catch { this.report("unsubscribe"); }
    this.unsubscribe = undefined;
    try { this.options.transport?.stop(); } catch { this.report("transport_stop"); }
  }
  private report(stage: string): void { try { this.options.logger.error("Wallet operation failed", { stage }); } catch { /* State is owned by SQLite. */ } }
  async start(): Promise<void> {
    this.assertCurrent();
    if (this.started) throw new WorkflowConflict("Wallet runtime already started. Restart the local backend to recover wallet operations.");
    this.started = true;
    this.options.records.recover(this.now());
    const transport = this.options.transport;
    if (!transport) { this.walletFailure = this.options.startupFailure ?? "configuration_missing"; return; }
    try {
      const sessions = await transport.restore(); this.assertCurrent();
      for (const session of sessions) {
        const known = this.options.records.connections().find((record) => record.topic === session.topic && record.connection.status === "connected");
        if (known) this.options.records.restoreConnection(session, this.now());
      }
      this.unsubscribe = transport.onSessionChanged((topic, selectionChanged) => {
        if (this.stopped || this.walletFailure) return;
        try { const work = () => this.reconcile(topic, selectionChanged); if (this.options.runExternalEvent) this.options.runExternalEvent(work); else work(); }
        catch { this.disableWallet("wallet_state_unavailable"); this.report("wallet_session_event"); }
      });
      this.walletReady = true;
    } catch { this.disableWallet("restoration_failed"); this.report("session_restore"); }
  }
  private reconcile(topic: string, selectionChanged = false): void {
    this.assertWalletAvailable();
    try {
      const current = this.options.transport?.session(topic);
      for (const record of this.options.records.connections()) {
        if (record.topic !== topic || record.ownerId !== this.options.ownerId || record.connection.status !== "connected") continue;
        if (!current) {
          this.options.records.applyConnectionChange(record.connection.connectionId, { status: "disconnected", reason: "Wallet session is unavailable." }, this.now());
        } else if (selectionChanged || !this.sameSession(record.connection, current)) {
          this.options.records.applyConnectionChange(record.connection.connectionId, { accounts: current.accounts, methods: current.methods,
            expiresAt: current.expiresAt, status: "connected", walletName: current.walletName }, this.now());
        }
      }
    } catch {
      this.disableWallet("wallet_state_unavailable");
      throw new WalletUnavailableError("wallet_state_unavailable");
    }
  }
  private sameSession(stored: { accounts: string[]; methods: string[]; expiresAt: string }, current: WalletSession): boolean {
    return stored.expiresAt === current.expiresAt && isDeepStrictEqual([...stored.accounts].sort(), [...current.accounts].sort()) &&
      isDeepStrictEqual([...stored.methods].sort(), [...current.methods].sort());
  }
  async prepare(kind: "connect" | "review", input: Record<string, unknown>): Promise<CardPreparation> {
    this.assertCurrent();
    const availability = this.walletAvailability();
    if (kind === "connect") return availability.status === "available" ? { status: "ready" } : {
      status: "failed", error: availability.message
    };
    if (typeof input.reviewSessionId !== "string") throw new WorkflowConflict("An exact review session is required.");
    const session = await this.options.sessions.getReviewSession(input.reviewSessionId, () => this.now()); this.assertCurrent();
    if (!session) throw new WorkflowConflict("The review session is unavailable.");
    if (input.mode === "manage") {
      if (typeof input.attemptId !== "string") throw new WorkflowConflict("An exact transaction attempt is required.");
      const request = this.options.records.request(input.attemptId);
      if (!request || request.reviewSessionId !== session.id) throw new WorkflowConflict("The attempt does not belong to this review session.");
    }
    return { status: "ready" };
  }

  refreshConnections(): void {
    this.assertCurrent();
    this.recoverDisconnects();
    this.options.records.evaluate({ walletAvailability: this.walletAvailability() });
  }
  private recoverDisconnects(): void {
    const available = this.walletAvailability().status === "available";
    for (const record of this.options.records.connections()) {
      if (record.ownerId !== this.options.ownerId || record.sdkPending) continue;
      const pending = this.options.records.pendingDisconnect(record.connection.connectionId);
      if (!pending) continue;
      // Disabled transports also return undefined; that is not session absence.
      const absent = available && !!record.topic && !this.options.transport!.session(record.topic);
      this.options.records.recoverDisconnect(pending.state.cardId, record.connection.connectionId, record.connection.revision, absent);
    }
  }
  private async evaluateReview(id: string, expectedCard?: CardRecord, uiObservation = false): Promise<EvaluatedWorkflowState> {
    this.assertCurrent();
    const preparation = this.options.sessions.readReviewSession(id)?.preparationId;
    if (preparation && !this.preparing.has(preparation)) this.options.records.failPreparation(id, preparation, this.now());
    const candidate = await this.options.sessions.inspectReview(id, this.now());
    this.assertCurrent();
    const evaluated = this.options.records.evaluate({ reviewSessionId: id, candidate, expectedCard,
      walletAvailability: this.walletAvailability(), uiObservation });
    this.options.sessions.recordEvaluationEvents(evaluated.events);
    return evaluated;
  }
  async readReview(id: string, explicitResult = false): Promise<ReviewSnapshot | undefined> {
    if (!this.options.sessions.readReviewSession(id)) return undefined;
    let state = await this.evaluateReview(id);
    if (state.request) {
      this.observe(state.request.attemptId, explicitResult);
      if (explicitResult) {
        await this.observing.get(state.request.attemptId);
        this.assertCurrent();
        // An awaited receipt may have committed new facts. Return one freshly
        // evaluated snapshot; ordinary status reads do not await external I/O.
        state = await this.evaluateReview(id);
      }
    }
    if (!state.session) return undefined;
    return { session: state.session, request: state.request, hasReviewInput: state.hasReviewInput, walletAvailability: state.walletAvailability,
      progress: reviewProgress(!!state.session.preparationId, state.request, state.walletAvailability,
        { stopped: state.authority?.observation_stopped === 1, pending: state.authority?.lookup_pending === 1 }) };
  }

  async describe(record: CardRecord, uiObservation = false): Promise<{
    evaluated: EvaluatedWorkflowState; data: WorkflowView; walletDisplay?: WalletDisplay; receiptDisplay?: ReceiptDisplay; displayAttemptId?: string;
  }> {
    this.assertCurrent();
    if (record.state.kind === "connect") this.recoverDisconnects();
    const evaluated = record.state.kind === "review"
      ? await this.evaluateReview(String(record.state.input.reviewSessionId), record, uiObservation)
      : this.options.records.evaluate({ expectedCard: record, walletAvailability: this.walletAvailability() });
    this.assertCurrent();
    if (record.state.kind === "connect") {
      const data = projectConnectionView(evaluated);
      const pairing = evaluated.connection && evaluated.walletAvailability.status === "available" ? this.pairings.get(evaluated.connection.connectionId) : undefined;
      return { evaluated, data, ...(pairing && evaluated.connection?.status === "awaiting_approval" ? { walletDisplay: pairing } : {}) };
    }
    const data = projectReviewView(evaluated);
    assertNoForbiddenMcpFields(data);
    if (uiObservation && evaluated.request && isInitialChainObservation(evaluated.request.requestStatus) && !evaluated.authority?.observation_stopped) this.observe(evaluated.request.attemptId);
    return { evaluated, data, ...(evaluated.receiptDisplay && evaluated.request ? { receiptDisplay: evaluated.receiptDisplay, displayAttemptId: evaluated.request.attemptId } : {}) };
  }

  async act(record: CardRecord, action: ReturnType<typeof parseWorkflowAction>): Promise<void> {
    this.assertCurrent();
    if (action.action === "request_signature" && record.scope === "review") {
      const recovered = this.options.records.recoverRequest(record, action, { reviewSessionId: String(record.state.input.reviewSessionId),
        reviewRevision: action.reviewRevision, account: action.account, connectionId: action.connectionId });
      if (recovered) return;
    }
    if (["connect", "disconnect", "use_account", "prepare_review", "request_signature"].includes(action.action)) this.assertWalletAvailable();
    const transport = this.options.transport;
    switch (action.action) {
      case "cancel": this.options.records.cancelInput(record); return;
      case "connect": {
        if (!transport) throw new WalletUnavailableError(this.options.startupFailure ?? "configuration_missing");
        const admitted = this.options.records.admitConnection(record, action);
        void this.connect(admitted.connection.connectionId).catch(() => this.report("connection"));
        return;
      }
      case "use_account": {
        if (!action.account) throw new WorkflowConflict("Select an account approved by the wallet.");
        const target = this.options.records.connection(action.connectionId);
        if (target?.topic) this.reconcile(target.topic);
        this.options.records.useAccount(record, action, action.connectionId, action.account); return;
      }
      case "disconnect": {
        if (!transport) throw new WalletUnavailableError(this.options.startupFailure ?? "configuration_missing");
        const target = this.options.records.admitDisconnect(record, action, action.connectionId);
        void (async () => {
          try {
            if (target.topic) await transport.disconnect(target.topic); this.assertWalletAvailable();
            this.options.records.finishDisconnect(record.state.cardId, action.connectionId, true, this.now());
          } catch { if (!this.stopped) this.options.records.finishDisconnect(record.state.cardId, action.connectionId, false, this.now()); }
          finally { if (!this.stopped) this.options.records.settleConnection(action.connectionId); }
        })().catch(() => this.report("disconnection")); return;
      }
      case "stop_connection": {
        const id = this.options.records.manage(record, action.action);
        this.pairings.delete(id);
        return;
      }
      case "prepare_review": {
        const id = String(record.state.input.reviewSessionId);
        const connection = this.requireWallet(action.connectionId, action.account);
        const preparation = this.options.records.beginReviewPreparation(record, action.reviewRevision, connection, action.account);
        this.preparing.add(preparation);
        void this.compute(id, preparation, action.account, connection.connectionId)
          .finally(() => this.preparing.delete(preparation)).catch(() => this.report("review_computation"));
        return;
      }
      case "request_signature": {
        if (!transport) throw new WalletUnavailableError(this.options.startupFailure ?? "configuration_missing");
        const id = String(record.state.input.reviewSessionId);
        const connection = this.requireWallet(action.connectionId, action.account);
        const session = this.options.sessions.readReviewSession(id);
        if (!session || session.reviewRevision !== action.reviewRevision || !session.plans[0]) throw new WorkflowConflict("Review revision changed.");
        let material;
        try { material = await this.options.sessions.prepareReviewedTransaction(id, session.plans[0].id, action.account, this.now()); }
        catch (error) {
          if (!(error instanceof SessionStoreError)) throw error;
          if (this.options.records.recoverRequest(record, action, { reviewSessionId: id, reviewRevision: action.reviewRevision,
            account: action.account, connectionId: action.connectionId })) return;
          await this.evaluateReview(id);
          throw new WorkflowConflict("Reviewed evidence is unavailable. Read and update the review before signing.");
        }
        this.assertWalletAvailable();
        let admitted;
        try { admitted = this.options.records.admitRequest(record, action, material, connection); }
        catch (error) {
          if (error instanceof WorkflowConflict) this.options.sessions.recordEvaluationEvents(error.events);
          throw error;
        }
        if (admitted.created) void this.sign(admitted.request, action.connectionId, material.transactionBytesBase64).catch(() => this.report("signature_request"));
        return;
      }
      case "stop_waiting": this.options.records.manage(record, action.action); return;
      case "read_result": {
        const id = this.options.records.manage(record, action.action);
        this.observe(id, true); return;
      }
    }
  }
  private requireWallet(id: string, account: string) {
    this.assertWalletAvailable();
    const record = this.options.records.connection(id);
    if (record?.topic) this.reconcile(record.topic);
    const current = this.options.records.connection(id);
    if (!isOwnedConnectedWallet(current, this.options.ownerId, !!this.options.records.pendingDisconnect(id)) ||
        !current.connection.accounts.includes(account) || Date.parse(current.connection.expiresAt) <= this.now().getTime()) {
      throw new WorkflowConflict("The selected Sui wallet connection is unavailable.");
    }
    return current.connection;
  }
  private async connect(id: string): Promise<void> {
    try {
      const result = await this.options.transport!.connect();
      let displayFailure: unknown;
      try {
        this.assertWalletAvailable();
        const current = this.options.records.connection(id);
        if (current?.connection.status === "awaiting_approval") {
          this.pairings.set(id, { connectionId: id, pairingUri: result.uri, expiresAt: result.expiresAt });
          this.options.records.updateConnection(id, { expiresAt: result.expiresAt }, this.now());
        }
      } catch (error) { displayFailure = error; }
      // The approval remains pending even if setup/QR recording fails or the
      // wallet dependency is disabled. Settle only after that promise ends.
      const session = await result.approval;
      if (displayFailure) throw displayFailure;
      this.assertWalletAvailable();
      const awaiting = this.options.records.connection(id);
      if (!awaiting || awaiting.connection.status !== "awaiting_approval" || Date.parse(awaiting.connection.expiresAt) <= this.now().getTime()) {
        await this.options.transport!.disconnect(session.topic);
        return;
      }
      this.options.records.updateConnection(id, { status: "connected", accounts: session.accounts, methods: session.methods,
        expiresAt: session.expiresAt, walletName: session.walletName }, this.now(), session.topic, false);
    } catch (error) {
      if (!this.stopped) {
        const current = this.options.records.connection(id);
        if (current?.connection.status === "awaiting_approval") this.options.records.updateConnection(id,
          { status: error instanceof WalletUserRejectedError ? "rejected" : "failed",
            reason: this.walletFailure ? "Wallet connection could not be confirmed. Check the connection in your wallet app and restart the local backend." :
              error instanceof WalletUserRejectedError ? error.message : "Wallet connection could not be confirmed." }, this.now(), undefined, false);
      }
    } finally { try { if (!this.stopped) this.options.records.settleConnection(id); } finally { this.pairings.delete(id); } }
  }
  private async compute(id: string, preparation: string, account: string, connectionId: string): Promise<void> {
    try {
      await this.options.sessions.recordWalletConnected(id, account, this.now()); this.assertWalletAvailable();
      const session = await this.options.sessions.getReviewSession(id, () => this.now());
      if (!session?.plans[0]) throw new WorkflowConflict("Review session is unavailable.");
      const computed = await computeReviewStateWithPrivateArtifacts({ reviewSessionId: id, plan: session.plans[0], account, now: this.now() }, this.options.computation);
      this.assertWalletAvailable();
      const currentConnection = this.requireWallet(connectionId, account);
      if (!this.options.records.isPreparing(id, preparation) || session.walletConnectionRevision !== currentConnection.revision) return;
      await this.options.sessions.recordReviewStateWithArtifacts(id, computed.state, computed.privateArtifacts, this.now(),
        { id: preparation, connectionId, connectionRevision: currentConnection.revision });
    } catch { if (!this.stopped) this.options.records.failPreparation(id, preparation, this.now()); }
  }
  private async sign(request: TransactionRequest, connectionId: string, bytesBase64: string): Promise<void> {
    try { await this.performSignature(request, connectionId, bytesBase64); }
    finally { if (!this.stopped) this.options.records.settle(request.attemptId, "sdk_pending", false); }
  }
  private async performSignature(request: TransactionRequest, connectionId: string, bytesBase64: string): Promise<void> {
    let response: { transactionBytes: string; signature: string };
    try {
      this.assertWalletAvailable();
      const connection = this.options.records.connection(connectionId);
      if (!connection?.topic || !connection.connection.methods.includes(SUI_SIGN_TRANSACTION_METHOD)) throw new WorkflowConflict("Wallet does not support Sui sign-only requests.");
      response = await this.options.transport!.sign({ topic: connection.topic, account: request.account, transactionBytesBase64: bytesBase64 });
      this.assertWalletAvailable();
    } catch {
      if (!this.stopped) this.options.records.transitionRequest(request.attemptId, "request_failed", this.now(), { reason: this.walletFailure ? "Wallet operations became unavailable before submission. The returned signature will not be submitted." : "The wallet rejected the request or did not return a signature." });
      return;
    }
    const current = this.options.records.request(request.attemptId);
    if (!current) return;
    this.options.records.advanceRequestDeadlines(this.now(), current.attemptId);
    if (this.options.records.request(request.attemptId)?.requestStatus !== "awaiting_signature") return;
    let bytes: Uint8Array;
    try {
      bytes = Buffer.from(response.transactionBytes, "base64");
      if (await Transaction.from(bytes).getDigest() !== request.transactionDigest) {
        throw new WorkflowConflict("The returned transaction does not match the reviewed transaction. Nothing was submitted.");
      }
      await verifyTransactionSignature(bytes, response.signature, { address: request.account,
        ...(this.options.signatureClient ? { client: this.options.signatureClient } : {}) }); this.assertWalletAvailable();
      await this.options.verifyNetwork(); this.assertWalletAvailable();
      this.requireWallet(connectionId, request.account);
      this.options.records.advanceRequestDeadlines(this.now(), request.attemptId);
      if (this.options.records.request(request.attemptId)?.requestStatus !== "awaiting_signature") return;
      this.options.records.transitionRequest(request.attemptId, "awaiting_signature", this.now(), { signatureVerified: true });
      if (!this.options.records.beginSubmission(request.attemptId)) return;
    } catch (error) {
      // SDK verification can itself depend on a remote source. An exception is
      // not proof of a mismatched transaction or signer.
      if (!this.stopped) this.options.records.transitionRequest(request.attemptId, "request_failed", this.now(), {
        reason: this.walletFailure ? "Wallet operations became unavailable before submission. The returned signature will not be submitted."
          : error instanceof WorkflowConflict ? error.message : "Submission checks could not be completed. Nothing was submitted."
      });
      return;
    }
    try { await this.options.submitTransaction(bytes, response.signature); }
    catch { /* A lost submit response is not proof of failure. Observe the same digest. */ }
    finally { if (!this.stopped) this.options.records.settle(request.attemptId, "submit_pending", false); }
    this.assertCurrent();
    try { this.options.records.finishSubmission(request.attemptId); }
    catch { this.report("submission_record"); return; }
    this.observe(request.attemptId);
  }
  observe(id: string, explicit = false): void {
    this.assertCurrent();
    if (this.observing.has(id)) return;
    const request = this.options.records.beginObservation(id, explicit);
    if (!request) return;
    const reading = (async () => {
      try {
        const result = await this.options.verifyReceipt({ txDigest: request.transactionDigest, reviewedTransactionDigest: request.transactionDigest, account: request.account, now: this.now() });
        this.assertCurrent();
        if (result.status === "verified_success" || result.status === "verified_failure") {
          let details: ReturnType<typeof projectReadCardResult> | undefined;
          if (this.options.readReceipt) {
            try {
              const receipt = await this.options.readReceipt({ digest: request.transactionDigest, now: this.now() });
              this.assertCurrent();
              if (receipt.status === "found") details = projectReadCardResult("receipt", { digest: request.transactionDigest }, receipt);
            } catch { /* Keep verified chain facts if the additional display read is unavailable. */ }
          }
          this.assertCurrent();
          this.options.records.transitionRequest(id, "completed", this.now(), { execution: {
            reviewSessionId: request.reviewSessionId, attemptId: id, planId: request.planId,
            status: result.status === "verified_success" ? "success" : "failure", txDigest: request.transactionDigest,
            chainReceipt: result.receipt, recordedAt: this.now().toISOString(),
            ...(result.status === "verified_failure" ? { failureReason: "chain_execution_failed" as const } : {})
          }, ...(details ? { details } : {}) });
        } else if (result.status === "verification_failed") {
          this.options.records.transitionRequest(id, "outcome_unknown", this.now(), { reason: "The chain result could not be verified for this request." });
        }
      } catch { if (!this.stopped) this.options.records.transitionRequest(id, "outcome_unknown", this.now(), { reason: "The chain result is unavailable. No transaction was sent again." }); }
      finally { try { if (!this.stopped) this.options.records.settle(id, "lookup_pending", false); } finally { this.observing.delete(id); } }
    })();
    this.observing.set(id, reading);
    void reading.catch(() => this.report("chain_observation"));
  }
  pendingConnections() {
    this.assertCurrent();
    this.recoverDisconnects();
    const rows: { cardId: string; connectionId?: string; status: PendingConnectionStatus; lastActivityAt: string; progress: WorkflowProgress }[] = [];
    for (const card of this.options.records.pendingConnectionCards(this.now())) {
      const evaluated = this.options.records.evaluate({ expectedCard: card, walletAvailability: this.walletAvailability() });
      if (evaluated.record?.state.state === "closed") continue;
      const data = projectConnectionView(evaluated);
      if (!data.connection) rows.push({ cardId: card.state.cardId, status: "input_required", lastActivityAt: card.state.createdAt, progress: data.progress });
      else if (data.connection.status === "awaiting_approval") rows.push({ cardId: card.state.cardId,
        connectionId: data.connection.connectionId, status: "awaiting_approval", lastActivityAt: data.connection.updatedAt, progress: data.progress });
      else if (data.connection.pendingAction === "disconnect") rows.push({ cardId: card.state.cardId,
        connectionId: data.connection.connectionId, status: "disconnect_pending", lastActivityAt: data.connection.updatedAt, progress: data.progress });
    }
    return rows;
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true; this.walletReady = false; this.releaseWallet();
  }
}
