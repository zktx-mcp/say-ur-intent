import { WalletWorkflow } from "../src/core/session/walletWorkflow.js";
import Database from "better-sqlite3";
import { join } from "node:path";
import { DEFAULT_SUI_GRPC_URL, DEFAULT_SUI_GRAPHQL_URL } from "../src/runtime/config.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { walletWorkflowFixture, deferred } from "./fixtures/walletWorkflow.js";
import { buildTestTransactionBytes } from "./fixtures/transactionMaterial.js";
import { findForbiddenMcpFields } from "../src/core/action/forbiddenFields.js";
import { waitForWalletConnection } from "../src/core/session/wait.js";

const fixtures: Awaited<ReturnType<typeof walletWorkflowFixture>>[] = [];
async function fixture() { const value = await walletWorkflowFixture(); fixtures.push(value); return value; }
afterEach(() => { for (const value of fixtures.splice(0)) value.close(); });

describe("stored wallet workflows", () => {
  it("keeps pairing private and creates it only after one admitted selection", async () => {
    const f = await fixture(); let card = await f.createConnection();
    expect(f.connect).not.toHaveBeenCalled();
    expect(findForbiddenMcpFields(card.snapshot)).toEqual([]);
    const first = await f.act(card, { action: "connect" });
    const duplicate = await f.act(card, { action: "connect" });
    expect(duplicate.error).toBeUndefined();
    expect(f.connect).toHaveBeenCalledOnce();
    card = await f.read(card);
    expect(card.walletDisplay?.pairingUri).toContain("wc:fixture");
    expect(JSON.stringify(card.snapshot)).not.toContain("symKey");
    expect(first.snapshot.state).toBe("running");
    expect((await f.run(() => f.cards.readSaved(card.snapshot.cardId))).data).toEqual(card.snapshot.data);
    expect(f.connect).toHaveBeenCalledOnce();
  });

  it("binds a signed request to its reviewed bytes and records only verified chain effects as execution", async () => {
    const f = await fixture(); const { connection } = await f.approve(); const ready = await f.prepare(connection.connectionId);
    const input = { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision };
    const response = await f.act(ready.card, input);
    expect(response.error).toBeUndefined();
    expect(response.snapshot.data).not.toHaveProperty("nextStateReadAfterMs");
    await f.act(ready.card, input);
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe("completed"));
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce();
    const request = f.run(() => f.records.currentRequest(ready.session.id))!;
    expect(request.execution?.status).toBe("success");
    expect(request.execution?.txDigest).toBe(request.transactionDigest);
    expect(findForbiddenMcpFields(request)).toEqual([]);
    await f.run(() => f.cards.readSaved(ready.card.snapshot.cardId));
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce();
  });

  it.each(["signer", "transaction"] as const)("refuses an otherwise valid response with a different %s", async (mismatch) => {
    const f = await fixture(); const { connection } = await f.approve(); const ready = await f.prepare(connection.connectionId);
    f.sign.mockImplementationOnce(async (input) => {
      const bytes = mismatch === "transaction" ? await buildTestTransactionBytes(f.account) : Buffer.from(input.transactionBytesBase64, "base64");
      const signed = await (mismatch === "signer" ? Ed25519Keypair.generate() : f.accountKey).signTransaction(bytes);
      return { transactionBytes: signed.bytes, signature: signed.signature };
    });
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe("request_failed"));
    expect(f.run(() => f.records.currentRequest(ready.session.id)?.reason)).toBe(mismatch === "transaction"
      ? "The returned transaction does not match the reviewed transaction. Nothing was submitted."
      : "Submission checks could not be completed. Nothing was submitted.");
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.run(() => f.records.currentRequest(ready.session.id)?.execution)).toBeUndefined();
  });

  it("does not submit a late valid signature after a stop and retains the unsettled-request guard", async () => {
    const f = await fixture(); const { connection } = await f.approve(); const ready = await f.prepare(connection.connectionId);
    const pending = deferred<{ transactionBytes: string; signature: string }>();
    let signed!: { transactionBytes: string; signature: string };
    f.sign.mockImplementationOnce(async (input) => { const result = await f.accountKey.signTransaction(Buffer.from(input.transactionBytesBase64, "base64"));
      signed = { transactionBytes: result.bytes, signature: result.signature }; return pending.promise; });
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
    await vi.waitFor(() => expect(signed).toBeDefined());
    const waiting = await f.read(ready.card); await f.act(waiting, { action: "stop_waiting" });
    expect(() => f.run(() => f.records.assertDataReplacementAllowed(f.now()))).toThrow("unsettled");
    pending.resolve(signed);
    await vi.waitFor(() => expect(f.run(() => f.records.authority(f.records.currentRequest(ready.session.id)!.attemptId)?.sdk_pending)).toBe(0));
    expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe("stopped");
    expect(f.submit).not.toHaveBeenCalled();
  });

  it("does not reinterpret a lost submission response as a chain failure or resubmit", async () => {
    const f = await fixture(); const { connection } = await f.approve(); const ready = await f.prepare(connection.connectionId);
    f.submit.mockRejectedValueOnce(new Error("Lost RPC response"));
    f.chainRead.mockRejectedValue(Object.assign(new Error("Not found in the initial observation"), { name: "TimeoutError" }));
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe("awaiting_chain_result"));
    f.advance(10 * 60 * 1000);
    await f.read(ready.card);
    const request = f.run(() => f.records.currentRequest(ready.session.id))!;
    expect(request.requestStatus).toBe("outcome_unknown"); expect(request.execution).toBeUndefined();
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce();
  });
});

describe("wallet startup and review expiry", () => {
  it.each(["restore", "record", "subscription"] as const)("disables wallet operations after a %s startup failure", async (stage) => {
    const f = await fixture(), { connection } = await f.approve();
    f.workflow.stop();
    vi.mocked(f.transport.stop).mockClear(); f.connect.mockClear();
    const records = f.activity.createWalletWorkflowStore("next-owner");
    const subscribe = vi.fn(f.transport.onSessionChanged);
    const restore = vi.fn(async () => {
      if (stage === "restore") throw new Error("PRIVATE-RESTORE-DETAIL");
      return [f.transport.session("fixture-topic")!];
    });
    const db = new Database(join(f.directory, "activity.sqlite"));
    if (stage === "record") db.exec("CREATE TRIGGER refuse_restore BEFORE UPDATE ON live_wallet_connections BEGIN SELECT RAISE(ABORT,'PRIVATE-STORAGE-DETAIL'); END");
    if (stage === "subscription") subscribe.mockImplementation(() => { throw new Error("PRIVATE-SUBSCRIPTION-DETAIL"); });
    const next = new WalletWorkflow({ records, sessions: f.sessions,
      ownerId: "next-owner", transport: { ...f.transport, restore, onSessionChanged: subscribe }, computation: f.computation,
      verifyReceipt: f.verifyReceipt, verifyNetwork: f.verifyNetwork, submitTransaction: f.submit,
      assertCurrent: f.access.assertCurrent, runExternalEvent: f.run, logger: f.logger, now: f.now });
    try {
      await f.run(() => next.start());
      await expect(f.run(() => next.prepare("connect", {}))).resolves.toMatchObject({ status: "failed", error: expect.stringContaining("could not be restored") });
      await expect(f.run(() => next.start())).rejects.toThrow("already started");
      expect(await f.run(() => next.readReview("any-review"))).toBeUndefined();
      expect(f.connect).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
      next.stop(); expect(f.transport.stop).toHaveBeenCalledOnce();
      expect(await f.run(() => f.activity.getActiveAccount())).toMatchObject({ address: connection.accounts[0] });
      expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain("PRIVATE-");
    } finally { next.stop(); db.exec("DROP TRIGGER IF EXISTS refuse_restore"); db.close(); }
  });

  it("projects material expiry independently of the card deadline and preserves explicit refresh", async () => {
    const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
    expect(ready.card.snapshot.data).toMatchObject({ actionRemainingMs: 1_800_000, nextStateReadAfterMs: 30_000 });
    f.advance(29_999);
    const before = await f.read(ready.card);
    expect(before.snapshot.data).toMatchObject({ actionRemainingMs: 1_770_001, nextStateReadAfterMs: 1 });
    f.advance(1);
    // Click/expiry race: no preceding read is needed to make the backend refuse.
    const refused = await f.act(before, { action: "request_signature", connectionId: connection.connectionId,
      account: f.account, reviewRevision: ready.session.reviewRevision });
    expect(refused.error?.code).toBe("card_conflict");
    expect(refused.snapshot.data).toMatchObject({ review: { status: "refresh_required", state: { refreshReason: "quote_stale" } } });
    expect(refused.snapshot.data).not.toHaveProperty("nextStateReadAfterMs");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    const expired = await f.read(ready.card);
    expect(expired.snapshot.data).toMatchObject({ allowedActions: ["cancel", "prepare_review"] });
    await f.act(expired, { action: "prepare_review", connectionId: connection.connectionId,
      account: f.account, reviewRevision: ready.session.reviewRevision });
    await vi.waitFor(async () => expect((await f.read(ready.card)).snapshot.data).toMatchObject({
      review: { status: "ready_for_wallet_review", reviewRevision: 2 }, nextStateReadAfterMs: 30_000
    }));
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  });
});

describe("request authority, lifecycle and actual chain observation", () => {
  it("returns the same admission from another card and rejects a different normalized selection", async () => {
    const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
    const other = await f.run(() => f.cards.create("review", { reviewSessionId: ready.session.id }));
    const pending = deferred<{ transactionBytes: string; signature: string }>(); f.sign.mockImplementationOnce(() => pending.promise);
    const input = { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision };
    await f.act(ready.card, input);
    const duplicate = await f.act(await f.read(other), { ...input, account: "0x" + f.account.slice(2).toUpperCase() });
    expect(duplicate.error).toBeUndefined();
    expect(f.sign).toHaveBeenCalledOnce();
    expect(f.run(() => f.cardRecords.get(other.snapshot.cardId)?.operationId))
      .toBe(f.run(() => f.records.currentRequest(ready.session.id)?.attemptId));
    const conflict = await f.act(await f.read(other), { ...input, account: `0x${"b".repeat(64)}` });
    expect(conflict.error).toBeDefined(); expect(f.sign).toHaveBeenCalledOnce();
    pending.reject(new Error("Wallet dismissed"));
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe("request_failed"));
    expect(f.submit).not.toHaveBeenCalled();
  });

  it.each(["deadline", "account", "network"] as const)("refuses a valid signature after the %s boundary changes", async (boundary) => {
    const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
    const pending = deferred<{ transactionBytes: string; signature: string }>();
    let signed: { transactionBytes: string; signature: string } | undefined;
    f.sign.mockImplementationOnce(async (input) => { const result = await f.accountKey.signTransaction(Buffer.from(input.transactionBytesBase64, "base64"));
      signed = { transactionBytes: result.bytes, signature: result.signature }; return pending.promise; });
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
    await vi.waitFor(() => expect(signed).toBeDefined());
    if (boundary === "deadline") f.advance(90_000);
    if (boundary === "account") f.notify({ topic: "fixture-topic", accounts: [`0x${"b".repeat(64)}`], chain: "sui:mainnet", methods: ["sui_signTransaction"], expiresAt: connection.expiresAt });
    if (boundary === "network") f.verifyNetwork.mockRejectedValueOnce(new Error("Different actual chain identifier"));
    pending.resolve(signed!);
    await vi.waitFor(() => expect(f.run(() => f.records.authority(f.records.currentRequest(ready.session.id)!.attemptId)?.sdk_pending)).toBe(0));
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.run(() => f.records.currentRequest(ready.session.id)?.execution)).toBeUndefined();
    expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe(boundary === "account" ? "stopped" : "request_failed");
    expect(f.run(() => f.records.currentRequest(ready.session.id)?.reason)).toBe(boundary === "network"
      ? "Submission checks could not be completed. Nothing was submitted."
      : boundary === "account" ? "The wallet connection changed or became unavailable before submission. Nothing was submitted."
        : "Local signing wait expired. The wallet request may still be open.");
  });

  it("records failed chain effects as a completed request with a separate failure result", async () => {
    const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
    f.setChainOutcome("failure");
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe("completed"));
    expect(f.run(() => f.records.currentRequest(ready.session.id)?.execution)).toMatchObject({ status: "failure", failureReason: "chain_execution_failed", chainReceipt: { effectsStatus: { success: false } } });
    expect(f.submit).toHaveBeenCalledOnce();
  });

  it("stops local observation after submission without claiming transaction cancellation", async () => {
    const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
    const submission = deferred<object>(); f.submit.mockImplementationOnce(() => submission.promise);
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
    await vi.waitFor(() => expect(f.submit).toHaveBeenCalledOnce());
    const request = f.run(() => f.records.currentRequest(ready.session.id))!;
    const management = await f.run(() => f.cards.create("review", { mode: "manage", reviewSessionId: ready.session.id, attemptId: request.attemptId }));
    expect((await f.act(management, { action: "stop_waiting" })).error).toBeUndefined();
    expect(f.run(() => f.records.request(request.attemptId)?.requestStatus)).toBe("submitting");
    expect(f.run(() => f.records.authority(request.attemptId)?.observation_stopped)).toBe(1);
    submission.resolve({});
    await vi.waitFor(() => expect(f.run(() => f.records.authority(request.attemptId)?.sdk_pending)).toBe(0));
    expect(f.chainRead).not.toHaveBeenCalled();
    await f.act(await f.read(management), { action: "read_result" });
    await vi.waitFor(() => expect(f.run(() => f.records.request(request.attemptId)?.requestStatus)).toBe("completed"));
    expect(f.submit).toHaveBeenCalledOnce();
    expect((await f.act(await f.read(management), { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision })).error).toBeDefined();
  });

  it("keeps failed preparation distinct from a consumed signing request and permits explicit retry", async () => {
    const f = await fixture(), { connection } = await f.approve();
    const session = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
    let card = await f.run(() => f.cards.create("review", { reviewSessionId: session.session.id }));
    const original = vi.mocked(f.sessions.recordWalletConnected).getMockImplementation()!;
    vi.spyOn(f.sessions, "recordWalletConnected").mockRejectedValueOnce(new Error("Private provider detail"));
    await f.act(card, { action: "prepare_review", connectionId: connection.connectionId, account: f.account, reviewRevision: 0 });
    await vi.waitFor(async () => {
      card = await f.read(card);
      expect(card.snapshot.data).toMatchObject({ review: { preparing: false, error: expect.stringContaining("could not be completed") } });
    });
    expect(card.snapshot.state).toBe("ready"); expect(f.sign).not.toHaveBeenCalled();
    expect(JSON.stringify(card.snapshot)).not.toContain("Private provider detail");
    vi.spyOn(f.sessions, "recordWalletConnected").mockImplementation(original);
    await f.act(card, { action: "prepare_review", connectionId: connection.connectionId, account: f.account, reviewRevision: 0 });
    await vi.waitFor(async () => expect((await f.run(() => f.sessions.getReviewSession(session.session.id, f.now)))?.status).toBe("ready_for_wallet_review"));
    expect((await f.read(card)).snapshot.state).toBe("ready");
  });
});


it("rolls back card, attempt, authority and history together when the admission write fails", async () => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  const db = new Database(join(f.directory, "activity.sqlite"));
  try {
    db.exec("CREATE TRIGGER reject_admission BEFORE INSERT ON review_status_transitions WHEN NEW.event='request_admitted' BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");
    await expect(f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision })).rejects.toThrow("fixture storage failure");
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.run(() => f.records.currentRequest(ready.session.id))).toBeUndefined();
    expect((await f.read(ready.card)).snapshot.state).toBe("ready");
    for (const table of ["review_requests", "live_request_authority", "review_executions"]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect(db.prepare("SELECT current_attempt_id FROM live_review_sessions WHERE id=?").get(ready.session.id)).toEqual({ current_attempt_id: null });
  } finally { db.exec("DROP TRIGGER IF EXISTS reject_admission"); db.close(); }
});

it("checks data replacement again after endpoint verification and preserves unsettled work", async () => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  await f.run(() => f.activity.createPreferencesRepository().ensureDefaultLocalSettings({ suiGrpcUrl: DEFAULT_SUI_GRPC_URL, suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL }));
  const verification = deferred<void>(), entered = deferred<void>();
  const service = f.activity.createLocalDataService({ suiGrpcUrl: DEFAULT_SUI_GRPC_URL, suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL,
    now: f.now, advanceRequestDeadlines: (now) => f.records.advanceRequestDeadlines(now),
    verifySuiGrpcUrl: async () => { entered.resolve(); await verification.promise; }, verifySuiGraphqlUrl: async () => {} });
  const backup = await f.run(() => service.exportLocalData(f.now()));
  const importing = f.run(() => service.importLocalDataReplace(backup));
  const rejection = expect(importing).rejects.toMatchObject({ details: { reason: "wallet_request_unsettled" } });
  await entered.promise;
  const pending = deferred<{ transactionBytes: string; signature: string }>(); f.sign.mockImplementationOnce(() => pending.promise);
  await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
  const request = f.run(() => f.records.currentRequest(ready.session.id))!;
  await f.act(await f.read(ready.card), { action: "stop_waiting" });
  await expect(f.run(() => service.resetLocalData())).rejects.toMatchObject({ details: { reason: "wallet_request_unsettled" } });
  verification.resolve(); await rejection;
  expect(f.run(() => f.records.request(request.attemptId)?.requestStatus)).toBe("stopped");
  pending.reject(new Error("Wallet dismissed"));
  await vi.waitFor(() => expect(f.run(() => f.records.authority(request.attemptId)?.sdk_pending)).toBe(0));
  await f.run(() => service.resetLocalData());
  expect(f.run(() => f.records.request(request.attemptId))).toBeUndefined(); expect(f.submit).not.toHaveBeenCalled();
});

it("coalesces receipt reads and keeps an unverified response unknown until the exact digest is confirmed", async () => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  const original = f.chainRead.getMockImplementation()!;
  const reading = deferred<Awaited<ReturnType<typeof f.chainRead>>>(); f.chainRead.mockImplementation(() => reading.promise);
  await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
  await vi.waitFor(() => expect(f.chainRead).toHaveBeenCalledOnce());
  await f.read(ready.card); await f.read(ready.card); expect(f.chainRead).toHaveBeenCalledOnce();
  const mismatched = await original();
  if (mismatched.$kind !== "Transaction") throw new Error("Fixture requires successful source data");
  mismatched.Transaction.digest = "1".repeat(32);
  reading.resolve(mismatched);
  await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe("outcome_unknown"));
  expect(f.run(() => f.records.currentRequest(ready.session.id)?.execution)).toBeUndefined();
  f.chainRead.mockImplementation(original);
  await f.run(() => f.workflow.readReview(ready.session.id, true));
  const completed = f.run(() => f.records.currentRequest(ready.session.id))!;
  expect(completed.requestStatus).toBe("completed");
  await f.run(() => f.workflow.readReview(ready.session.id, true));
  expect(f.run(() => f.records.currentRequest(ready.session.id))).toEqual(completed);
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce();
});

it("keeps observing an explicit unknown-result lookup until its response arrives", async () => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  const original = f.chainRead.getMockImplementation()!;
  f.chainRead.mockRejectedValue(Object.assign(new Error("Not found"), { name: "TimeoutError" }));
  await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
  await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe("awaiting_chain_result"));
  f.advance(10 * 60 * 1000); let card = await f.read(ready.card);
  expect(card.snapshot.data).toMatchObject({ request: { requestStatus: "outcome_unknown" }, observe: false });
  const reading = deferred<Awaited<ReturnType<typeof f.chainRead>>>(); f.chainRead.mockImplementation(() => reading.promise);
  const response = await f.act(card, { action: "read_result" });
  expect(response.snapshot.data).toMatchObject({ request: { requestStatus: "outcome_unknown" }, observe: true });
  reading.resolve(await original());
  await vi.waitFor(async () => { card = await f.read(ready.card); expect(card.snapshot.data).toMatchObject({ request: { requestStatus: "completed" }, observe: false }); });
  expect(f.submit).toHaveBeenCalledOnce();
});

it("preserves the evaluated revision when admission commits after a state read was finalized", async () => {
  const f = await fixture(), card = await f.createConnection();
  const original = f.workflow.describe.bind(f.workflow), entered = deferred<void>(), release = deferred<void>();
  vi.spyOn(f.workflow, "describe").mockImplementationOnce(async (...args) => {
    const view = await original(...args); entered.resolve(); await release.promise; return view;
  });
  const reading = f.read(card); await entered.promise;
  const admitted = await f.act(card, { action: "connect" });
  expect(admitted.error).toBeUndefined(); release.resolve();
  const evaluated = await reading;
  expect(evaluated.snapshot.state).toBe("ready");
  expect(evaluated.snapshot.revision).toBe(card.snapshot.revision);
  expect((evaluated.snapshot.data as { connection?: unknown }).connection).toBeUndefined();
  expect(evaluated.walletDisplay).toBeUndefined();
  const current = await f.read(card);
  expect(current.snapshot.state).toBe("running");
  expect(current.snapshot.data).toMatchObject({ connection: { connectionId: current.walletDisplay!.connectionId, status: "awaiting_approval" } });
  expect(current.snapshot.revision).toBe(f.run(() => f.cardRecords.get(card.snapshot.cardId)!.state.revision));
  expect(f.connect).toHaveBeenCalledOnce();
});

it("invalidates an unadmitted review when a wallet selection changes without changing its approved account set", async () => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  f.notify({ topic: "fixture-topic", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet", expiresAt: connection.expiresAt }, true);
  const changed = await f.read(ready.card);
  expect(changed.snapshot.data).toMatchObject({ review: { status: "refresh_required", state: { refreshReason: "wallet_connection_changed" } } });
  expect((changed.snapshot.data as { allowedActions: string[] }).allowedActions).not.toContain("request_signature");
  expect(f.sign).not.toHaveBeenCalled();
});

it("disables the workflow if a wallet-change transaction cannot be committed and ignores its late signature", async () => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  const pending = deferred<{ transactionBytes: string; signature: string }>(); let signed: { transactionBytes: string; signature: string } | undefined;
  f.sign.mockImplementationOnce(async (input) => { const response = await f.accountKey.signTransaction(Buffer.from(input.transactionBytesBase64, "base64")); signed = { transactionBytes: response.bytes, signature: response.signature }; return pending.promise; });
  await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
  await vi.waitFor(() => expect(signed).toBeDefined());
  const db = new Database(join(f.directory, "activity.sqlite"));
  try {
    db.exec("CREATE TRIGGER reject_wallet_change BEFORE UPDATE ON live_wallet_connections BEGIN SELECT RAISE(ABORT,'fixture write failure'); END");
    f.notify({ topic: "fixture-topic", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet", expiresAt: connection.expiresAt }, true);
    expect((await f.read(ready.card)).snapshot.data).toMatchObject({ walletAvailability: { status: "unavailable", reason: "wallet_state_unavailable" }, progress: { status: "unavailable" } });
    expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe("awaiting_signature");
    pending.resolve(signed!); await new Promise((resolve) => setImmediate(resolve));
    expect(f.submit).not.toHaveBeenCalled(); expect(f.transport.stop).toHaveBeenCalledOnce();
  } finally { db.exec("DROP TRIGGER IF EXISTS reject_wallet_change"); db.close(); }
});

it("does not reopen expired review state when a late preparation write fails", async () => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  const pending = deferred<void>(), entered = deferred<void>();
  const original = vi.mocked(f.sessions.recordReviewStateWithArtifacts).getMockImplementation()!;
  vi.spyOn(f.sessions, "recordReviewStateWithArtifacts").mockImplementationOnce(async (...args) => {
    entered.resolve(); await pending.promise; return original(...args);
  });
  await f.act(ready.card, { action: "prepare_review", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
  await entered.promise; f.advance(30 * 60 * 1000);
  expect((await f.run(() => f.sessions.getReviewSession(ready.session.id, f.now)))?.status).toBe("expired");
  pending.resolve();
  await vi.waitFor(async () => expect((await f.run(() => f.sessions.getReviewSession(ready.session.id, f.now)))?.preparationId).toBeUndefined());
  const history = await f.run(() => f.activity.getReviewSessionDetail({ reviewSessionId: ready.session.id, account: f.account }));
  expect(history.session.reviewStatus).toBe("expired"); expect(f.sign).not.toHaveBeenCalled();
});


it("recovers interrupted requests without replay, preserves completed facts, and clears former-owner private material", async () => {
  const f = await fixture(), { connection } = await f.approve(), completed = await f.prepare(connection.connectionId);
  await f.act(completed.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: completed.session.reviewRevision });
  await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(completed.session.id)?.requestStatus)).toBe("completed"));
  const saved = f.run(() => f.records.currentRequest(completed.session.id))!;
  const interrupted = await f.prepare(connection.connectionId), pending = deferred<{ transactionBytes: string; signature: string }>();
  let late: { transactionBytes: string; signature: string } | undefined;
  f.sign.mockImplementationOnce(async (input) => { const response = await f.accountKey.signTransaction(Buffer.from(input.transactionBytesBase64, "base64")); late = { transactionBytes: response.bytes, signature: response.signature }; return pending.promise; });
  await f.act(interrupted.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: interrupted.session.reviewRevision });
  await vi.waitFor(() => expect(late).toBeDefined());
  const request = f.run(() => f.records.currentRequest(interrupted.session.id))!;
  await f.run(() => f.activity.clearActiveAccount(f.now())); f.workflow.stop();
  const nextRecords = f.activity.createWalletWorkflowStore("replacement");
  const sign = vi.fn(), connect = vi.fn(), submit = vi.fn();
  const next = new WalletWorkflow({ records: nextRecords, sessions: f.sessions, ownerId: "replacement",
    computation: f.computation, transport: { ...f.transport, sign, connect, restore: async () => [f.transport.session("fixture-topic")!] },
    verifyReceipt: f.verifyReceipt, verifyNetwork: f.verifyNetwork, submitTransaction: submit,
    assertCurrent: f.access.assertCurrent, runExternalEvent: f.run, logger: f.logger, now: f.now });
  try {
    await f.run(() => next.start());
    expect(f.run(() => nextRecords.request(saved.attemptId))).toEqual(saved);
    expect(f.run(() => nextRecords.request(request.attemptId)?.requestStatus)).toBe("outcome_unknown");
    expect(f.run(() => nextRecords.authority(request.attemptId))).toMatchObject({ owner_id: "replacement", can_submit: 0, sdk_pending: 0, submit_pending: 0, lookup_pending: 0 });
    expect(await f.run(() => f.activity.getActiveAccount())).toBeUndefined();
    const db = new Database(join(f.directory, "activity.sqlite"));
    try { expect(db.prepare("SELECT COUNT(*) AS n FROM live_transaction_materials").get()).toEqual({ n: 0 }); expect(db.prepare("SELECT COUNT(*) AS n FROM live_private_review_artifacts").get()).toEqual({ n: 0 }); }
    finally { db.close(); }
    pending.resolve(late!); await new Promise((resolve) => setImmediate(resolve));
    expect(f.submit).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    f.chainRead.mockRejectedValue(Object.assign(new Error("Not visible yet"), { name: "TimeoutError" }));
    expect((await f.run(() => next.readReview(interrupted.session.id, true)))?.request?.transactionDigest).toBe(request.transactionDigest);
    expect(submit).not.toHaveBeenCalled();
    const detail = await f.run(() => f.activity.getReviewSessionDetail({ reviewSessionId: interrupted.session.id, account: f.account }));
    expect(detail.transitions.filter((event) => event.event === "expired")).toHaveLength(1);
  } finally { next.stop(); }
});

describe("disconnect admission and completion share the stored card operation", () => {
  it.each(["success", "failure"] as const)("observes a delayed %s without treating a session update as completion", async (outcome) => {
    const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
    const pending = deferred<void>(); vi.mocked(f.transport.disconnect).mockImplementationOnce(() => pending.promise);
    const card = await f.createConnection(), other = await f.createConnection();
    const input = { action: "disconnect", connectionId: connection.connectionId };
    const admitted = await f.act(await f.read(card), input);
    expect(admitted.error).toBeUndefined();
    expect(admitted.snapshot).toMatchObject({ state: "running", data: { observe: true,
      connection: { status: "connected", pendingAction: "disconnect" } } });
    await f.act(card, input);
    expect(f.transport.disconnect).toHaveBeenCalledOnce();
    expect((await f.run(() => f.workflow.pendingConnections())).find((row) => row.cardId === card.snapshot.cardId))
      .toMatchObject({ status: "disconnect_pending", connectionId: connection.connectionId });
    for (const action of [input, { action: "use_account", connectionId: connection.connectionId, account: f.account }]) {
      expect((await f.act(await f.read(other), action)).error).toBeDefined();
    }
    expect((await f.act(await f.read(ready.card), { action: "prepare_review", connectionId: connection.connectionId,
      account: f.account, reviewRevision: ready.session.reviewRevision })).error).toBeDefined();
    f.notify({ topic: "fixture-topic", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet",
      expiresAt: new Date(Date.parse(connection.expiresAt) + 1000).toISOString() });
    expect((await f.read(card)).snapshot).toMatchObject({ state: "running", data: { observe: true } });
    const waiting = await f.run(() => waitForWalletConnection(f.cards, card.snapshot.cardId, { timeoutMs: 0 }));
    expect(waiting.waitOutcome).toBe("timed_out");
    if (outcome === "success") pending.resolve(); else pending.reject(new Error("PRIVATE-SDK-DETAIL"));
    await vi.waitFor(() => expect(f.run(() => f.records.connection(connection.connectionId)?.sdkPending)).toBe(false));
    const final = await f.read(card);
    expect(final.snapshot).toMatchObject({ state: "closed", data: { observe: false,
      connection: { status: outcome === "success" ? "disconnected" : "failed" } } });
    expect(JSON.stringify(final)).not.toContain("PRIVATE-SDK-DETAIL");
    expect((await f.run(() => waitForWalletConnection(f.cards, card.snapshot.cardId, { timeoutMs: 0 }))).waitOutcome).toBe("status_reached");
    expect((await f.run(() => f.workflow.pendingConnections())).some((row) => row.cardId === card.snapshot.cardId)).toBe(false);
    expect(f.transport.disconnect).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  });

  it("does not overwrite a confirmed session deletion with a later disconnect error", async () => {
    const f = await fixture(), { connection } = await f.approve(), card = await f.createConnection();
    const pending = deferred<void>(); vi.mocked(f.transport.disconnect).mockImplementationOnce(() => pending.promise);
    await f.act(card, { action: "disconnect", connectionId: connection.connectionId });
    f.notify(undefined);
    const final = await f.read(card);
    expect(final.snapshot).toMatchObject({ state: "closed", data: { observe: false, connection: { status: "disconnected" } } });
    pending.reject(new Error("Late acknowledgement failure"));
    await vi.waitFor(() => expect(f.run(() => f.records.connection(connection.connectionId)?.sdkPending)).toBe(false));
    expect((await f.read(card)).snapshot).toEqual(final.snapshot);
  });

  it("rolls back disconnect admission before calling the wallet", async () => {
    const f = await fixture(), { connection } = await f.approve(), card = await f.createConnection();
    const db = new Database(join(f.directory, "activity.sqlite"));
    try {
      db.exec("CREATE TRIGGER reject_disconnect BEFORE UPDATE ON live_wallet_connections BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");
      await expect(f.act(card, { action: "disconnect", connectionId: connection.connectionId })).rejects.toThrow("fixture storage failure");
      expect(f.run(() => f.cardRecords.get(card.snapshot.cardId))).toMatchObject({ state: { state: "ready", revision: card.snapshot.revision } });
      expect(f.run(() => f.records.pendingDisconnect(connection.connectionId))).toBeUndefined();
      expect(f.transport.disconnect).not.toHaveBeenCalled();
    } finally { db.exec("DROP TRIGGER reject_disconnect"); db.close(); }
  });

  it("recovers an interrupted disconnect without restoring or replaying that connection", async () => {
    const f = await fixture(), { connection } = await f.approve(), card = await f.createConnection();
    const pending = deferred<void>(); vi.mocked(f.transport.disconnect).mockImplementationOnce(() => pending.promise);
    await f.act(card, { action: "disconnect", connectionId: connection.connectionId }); f.workflow.stop();
    const nextRecords = f.activity.createWalletWorkflowStore("replacement"), disconnect = vi.fn();
    const next = new WalletWorkflow({ records: nextRecords, sessions: f.sessions,
      ownerId: "replacement", transport: { ...f.transport, disconnect, restore: async () => [f.transport.session("fixture-topic")!] },
      computation: f.computation, verifyReceipt: f.verifyReceipt, verifyNetwork: f.verifyNetwork, submitTransaction: f.submit,
      assertCurrent: f.access.assertCurrent, runExternalEvent: f.run, logger: f.logger, now: f.now });
    try {
      await f.run(() => next.start());
      expect(f.run(() => nextRecords.connection(connection.connectionId))).toMatchObject({ ownerId: "replacement", sdkPending: false,
        connection: { status: "failed", reason: expect.stringContaining("before wallet disconnection") } });
      pending.resolve(); await new Promise((resolve) => setImmediate(resolve));
      expect(f.run(() => nextRecords.connection(connection.connectionId)?.connection.status)).toBe("failed");
      expect(disconnect).not.toHaveBeenCalled(); expect(f.transport.disconnect).toHaveBeenCalledOnce();
    } finally { next.stop(); }
  });

  it("does not recreate a connection when disconnect finishes after local reset", async () => {
    const f = await fixture(), { connection } = await f.approve(), card = await f.createConnection();
    const pending = deferred<void>(); vi.mocked(f.transport.disconnect).mockImplementationOnce(() => pending.promise);
    await f.act(card, { action: "disconnect", connectionId: connection.connectionId });
    await f.run(() => f.localData.resetLocalData());
    pending.resolve(); await new Promise((resolve) => setImmediate(resolve));
    expect(f.run(() => f.records.connections())).toEqual([]);
    expect(f.run(() => f.cardRecords.get(card.snapshot.cardId))).toBeUndefined();
  });
});

describe("current data decisions settle request deadlines without a View", () => {
  it.each(["counts", "preview"] as const)("advances the deadline at %s while activity and export remain stored reads", async (consumer) => {
    const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
    f.chainRead.mockRejectedValue(Object.assign(new Error("Not found"), { name: "TimeoutError" }));
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
    await vi.waitFor(() => {
      const request = f.run(() => f.records.currentRequest(ready.session.id))!;
      expect(request.requestStatus).toBe("awaiting_chain_result");
      expect(f.run(() => f.records.authority(request.attemptId))).toMatchObject({ sdk_pending: 0, lookup_pending: 0 });
    });
    const before = f.run(() => f.records.currentRequest(ready.session.id))!;
    f.advance(599_999);
    expect((await f.run(() => f.localData.getDataCounts())).outcomeUnknownRequests).toBe(0);
    f.advance(1);
    const history = await f.run(() => f.activity.getReviewSessionDetail({ reviewSessionId: ready.session.id, account: f.account }));
    const backup = await f.run(() => f.localData.exportLocalData(f.now()));
    expect(history.request?.requestStatus).toBe("awaiting_chain_result");
    expect(f.run(() => f.records.request(before.attemptId))).toEqual(before);
    const counts = consumer === "counts" ? await f.run(() => f.localData.getDataCounts())
      : (await f.run(() => f.localData.previewImportLocalData(backup))).currentCounts;
    expect(counts.outcomeUnknownRequests).toBe(1); expect(counts.reviewExecutions).toBe(0);
    const after = f.run(() => f.records.request(before.attemptId))!;
    expect(after).toMatchObject({ requestStatus: "outcome_unknown", revision: before.revision + 1 });
    await f.run(() => f.localData.getDataCounts());
    const updated = await f.run(() => f.activity.getReviewSessionDetail({ reviewSessionId: ready.session.id, account: f.account }));
    expect(updated.request).toEqual(after);
    expect(updated.transitions.filter((row) => row.toStatus === "outcome_unknown")).toHaveLength(1);
    expect((await f.run(() => f.localData.exportLocalData(f.now()))).data.reviewRequests[0]?.request_status).toBe("outcome_unknown");
    expect(f.run(() => f.records.request(before.attemptId))).toEqual(after);
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce(); expect(f.chainRead).toHaveBeenCalledOnce();
  });

  it("keeps data replacement blocked after signing expires while its callback is unsettled", async () => {
    const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
    const pending = deferred<{ transactionBytes: string; signature: string }>(); f.sign.mockImplementationOnce(() => pending.promise);
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
    const request = f.run(() => f.records.currentRequest(ready.session.id))!;
    f.advance(90_000);
    await f.run(() => f.localData.getDataCounts());
    expect(f.run(() => f.records.request(request.attemptId)?.requestStatus)).toBe("request_failed");
    await expect(f.run(() => f.localData.resetLocalData())).rejects.toMatchObject({ details: { reason: "wallet_request_unsettled" } });
    expect(f.run(() => f.records.authority(request.attemptId))).toMatchObject({ sdk_pending: 1, can_submit: 0 });
    pending.reject(new Error("Wallet dismissed"));
    await vi.waitFor(() => expect(f.run(() => f.records.authority(request.attemptId)?.sdk_pending)).toBe(0));
    expect(f.submit).not.toHaveBeenCalled();
  });

  it("retains an in-flight lookup after its deadline and records a later verified chain result", async () => {
    const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
    const source = f.chainRead.getMockImplementation()!;
    const pending = deferred<Awaited<ReturnType<typeof f.chainRead>>>(); f.chainRead.mockImplementationOnce(() => pending.promise);
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
    await vi.waitFor(() => expect(f.chainRead).toHaveBeenCalledOnce());
    const request = f.run(() => f.records.currentRequest(ready.session.id))!;
    f.advance(600_000);
    expect((await f.run(() => f.localData.getDataCounts())).outcomeUnknownRequests).toBe(1);
    expect(f.run(() => f.records.authority(request.attemptId)?.lookup_pending)).toBe(1);
    await expect(f.run(() => f.localData.resetLocalData())).rejects.toMatchObject({ details: { reason: "wallet_request_unsettled" } });
    pending.resolve(await source());
    await vi.waitFor(() => expect(f.run(() => f.records.request(request.attemptId)?.requestStatus)).toBe("completed"));
    expect((await f.run(() => f.localData.getDataCounts())).outcomeUnknownRequests).toBe(0);
    expect(f.run(() => f.records.request(request.attemptId)?.execution?.status)).toBe("success");
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce(); expect(f.chainRead).toHaveBeenCalledOnce();
  });

  it.each(["reset", "import"] as const)("settles the deadline inside %s without a preceding counts/read call", async (operation) => {
    const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
    const backup = await f.run(() => f.localData.exportLocalData(f.now()));
    f.chainRead.mockRejectedValue(Object.assign(new Error("Not found"), { name: "TimeoutError" }));
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
    await vi.waitFor(() => {
      const request = f.run(() => f.records.currentRequest(ready.session.id))!;
      expect(request.requestStatus).toBe("awaiting_chain_result");
      expect(f.run(() => f.records.authority(request.attemptId))).toMatchObject({ sdk_pending: 0, lookup_pending: 0 });
    });
    const db = new Database(join(f.directory, "activity.sqlite"));
    // The deletion boundary must see the stored outcome, not just an elapsed timestamp.
    db.exec("CREATE TRIGGER require_expired_outcome BEFORE DELETE ON review_requests WHEN OLD.request_status!='outcome_unknown' BEGIN SELECT RAISE(ABORT,'unsettled stored outcome'); END");
    try {
      if (operation === "reset") { f.advance(600_000); await f.run(() => f.localData.resetLocalData()); }
      else {
        const entered = deferred<void>(), release = deferred<void>();
        const service = f.activity.createLocalDataService({ now: f.now, advanceRequestDeadlines: (now) => f.records.advanceRequestDeadlines(now),
          suiGrpcUrl: DEFAULT_SUI_GRPC_URL, suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL,
          verifySuiGrpcUrl: async () => { entered.resolve(); await release.promise; }, verifySuiGraphqlUrl: async () => {} });
        const importing = f.run(() => service.importLocalDataReplace(backup));
        await entered.promise; f.advance(600_000); release.resolve(); await importing;
      }
      expect(f.run(() => f.records.currentRequest(ready.session.id))).toBeUndefined();
      expect(f.submit).toHaveBeenCalledOnce();
    } finally { db.exec("DROP TRIGGER require_expired_outcome"); db.close(); }
  });
});

// A failed wallet event disables that dependency without closing the DB owner.
// The source is restored immediately, so subsequent failures cannot be blamed
// on an injected source exception rather than the disabled wallet boundary.
function failWalletEvents(f: Awaited<ReturnType<typeof walletWorkflowFixture>>) {
  const source = vi.spyOn(f.transport, "session").mockImplementation(() => { throw new Error("PRIVATE-WALLET-STATE"); });
  try { f.notify(); } finally { source.mockRestore(); }
  expect(f.run(() => f.workflow.walletAvailability())).toMatchObject({ status: "unavailable", reason: "wallet_state_unavailable" });
}

it.each(["submission", "lookup"] as const)("records dispatched chain facts and settles callbacks after wallet failure during %s", async (phase) => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  const submit = deferred<{}>(), lookup = deferred<Awaited<ReturnType<typeof f.chainRead>>>();
  const source = f.chainRead.getMockImplementation()!;
  if (phase === "submission") f.submit.mockImplementationOnce(() => submit.promise);
  else f.chainRead.mockImplementationOnce(() => lookup.promise);
  await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
  await vi.waitFor(() => expect(phase === "submission" ? f.submit : f.chainRead).toHaveBeenCalledOnce());
  const request = f.run(() => f.records.currentRequest(ready.session.id))!;
  failWalletEvents(f);
  const pendingField = phase === "submission" ? "submit_pending" : "lookup_pending";
  expect(f.run(() => f.records.authority(request.attemptId))?.[pendingField]).toBe(1);
  await expect(f.run(() => f.localData.resetLocalData())).rejects.toMatchObject({ details: { reason: "wallet_request_unsettled" } });
  if (phase === "submission") submit.resolve({}); else lookup.resolve(await source());
  await vi.waitFor(() => expect(f.run(() => f.records.request(request.attemptId))?.requestStatus).toBe("completed"));
  expect(f.run(() => f.records.authority(request.attemptId))).toMatchObject({ can_submit: 0, sdk_pending: 0, submit_pending: 0, lookup_pending: 0 });
  expect((await f.read(ready.card)).snapshot.data).toMatchObject({ walletAvailability: { status: "unavailable" }, progress: { status: "idle" },
    request: { attemptId: request.attemptId, transactionDigest: request.transactionDigest, execution: { status: "success" } } });
  await f.run(() => f.workflow.readReview(ready.session.id, true));
  expect(f.submit).toHaveBeenCalledOnce(); expect(f.sign).toHaveBeenCalledOnce(); expect(f.chainRead).toHaveBeenCalledOnce();
});

it("keeps snapshot readers pure while explicit current reads own request and review expiry", async () => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  const pending = deferred<{ transactionBytes: string; signature: string }>(); f.sign.mockImplementationOnce(() => pending.promise);
  await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
  const stored = f.run(() => ({ session: f.sessions.readReviewSession(ready.session.id), request: f.records.currentRequest(ready.session.id) }));
  f.advance(90_000);
  expect(f.run(() => f.sessions.readReviewSession(ready.session.id))).toEqual(stored.session);
  expect(f.run(() => f.records.currentRequest(ready.session.id))).toEqual(stored.request);
  const current = await f.run(() => f.workflow.readReview(ready.session.id));
  expect(current?.request?.requestStatus).toBe("request_failed");
  expect(f.run(() => f.records.authority(stored.request!.attemptId))?.sdk_pending).toBe(1);
  pending.reject(new Error("Wallet dismissed"));
  await vi.waitFor(() => expect(f.run(() => f.records.authority(stored.request!.attemptId))?.sdk_pending).toBe(0));
  expect(f.submit).not.toHaveBeenCalled(); expect(f.chainRead).not.toHaveBeenCalled();
});

it("settles a disabled wallet's disconnect without claiming that the remote connection closed", async () => {
  const f = await fixture(), { connection } = await f.approve(), card = await f.createConnection();
  const pending = deferred<void>(); vi.mocked(f.transport.disconnect).mockImplementationOnce(() => pending.promise);
  await f.act(card, { action: "disconnect", connectionId: connection.connectionId }); failWalletEvents(f);
  const read = await f.read(card);
  expect(read.snapshot.data).toMatchObject({ progress: { status: "unavailable" }, observe: false, connection: { status: "connected", pendingAction: "disconnect" } });
  expect((await f.run(() => waitForWalletConnection(f.cards, card.snapshot.cardId))).waitOutcome).toBe("unavailable");
  expect(f.run(() => f.records.connection(connection.connectionId))?.sdkPending).toBe(true);
  pending.resolve();
  await vi.waitFor(() => expect(f.run(() => f.records.connection(connection.connectionId))?.sdkPending).toBe(false));
  expect((await f.read(card)).snapshot).toMatchObject({ state: "closed", reason: "completed", data: { connection: { status: "failed" }, progress: { status: "idle" } } });
  expect(f.transport.disconnect).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
});

it("does not release a pairing's pending guard before its approval promise settles", async () => {
  const f = await fixture(), card = await f.createConnection();
  const opening = deferred<Awaited<ReturnType<typeof f.transport.connect>>>(), approval = deferred<Awaited<Awaited<ReturnType<typeof f.transport.connect>>["approval"]>>();
  f.connect.mockImplementationOnce(() => opening.promise);
  await f.act(card, { action: "connect" });
  const connectionId = f.run(() => f.cardRecords.get(card.snapshot.cardId))!.operationId!;
  failWalletEvents(f);
  opening.resolve({ uri: "wc:fixture", expiresAt: new Date(f.now().getTime() + 300_000).toISOString(), approval: approval.promise });
  await new Promise((resolve) => setImmediate(resolve));
  expect(f.run(() => f.records.connection(connectionId))?.sdkPending).toBe(true);
  expect((await f.read(card)).walletDisplay).toBeUndefined();
  approval.reject(new Error("Approval closed"));
  await vi.waitFor(() => expect(f.run(() => f.records.connection(connectionId))?.sdkPending).toBe(false));
  expect((await f.read(card)).snapshot.data).toMatchObject({ connection: { status: "failed" }, progress: { status: "idle" } });
  expect(f.connect).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
});

it("refuses submission if wallet state becomes unavailable during mainnet verification", async () => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  const verifying = deferred<void>(); f.verifyNetwork.mockImplementationOnce(() => verifying.promise);
  await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: ready.session.reviewRevision });
  await vi.waitFor(() => expect(f.verifyNetwork).toHaveBeenCalledOnce()); failWalletEvents(f);
  const request = f.run(() => f.records.currentRequest(ready.session.id))!;
  verifying.resolve();
  await vi.waitFor(() => expect(f.run(() => f.records.authority(request.attemptId))?.sdk_pending).toBe(0));
  expect(f.run(() => f.records.request(request.attemptId))?.requestStatus).toBe("request_failed");
  expect(f.run(() => f.records.request(request.attemptId))?.reason)
    .toBe("Wallet operations became unavailable before submission. The returned signature will not be submitted.");
  expect(f.submit).not.toHaveBeenCalled(); expect(f.chainRead).not.toHaveBeenCalled();
});

it.each(["owner", "disconnected"] as const)("refuses account selection when only the recorded connection %s differs", async (boundary) => {
  const f = await fixture(), { connection } = await f.approve();
  let card = await f.createConnection();
  const active = await f.run(() => f.activity.getActiveAccount());
  const db = new Database(join(f.directory, "activity.sqlite"));
  try {
    if (boundary === "owner") db.prepare("UPDATE live_wallet_connections SET owner_id=? WHERE id=?").run("other-owner", connection.connectionId);
    else f.run(() => f.records.updateConnection(connection.connectionId, { status: "disconnected" }, f.now()));
    // Use the current card revision; connection rejection must not be masked by
    // stale card input or absent permission.
    card = await f.read(card);
    const before = f.run(() => f.cardRecords.get(card.snapshot.cardId));
    const refused = await f.act(card, { action: "use_account", connectionId: connection.connectionId, account: f.account });
    expect(refused.error).toEqual({ code: "card_conflict", message: "The selected wallet account is no longer available." });
    expect(f.run(() => f.cardRecords.get(card.snapshot.cardId))).toEqual(before);
    expect(await f.run(() => f.activity.getActiveAccount())).toEqual(active);
    expect(f.transport.disconnect).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  } finally { db.close(); }
});

it("rejects expired connection use, preparation and signing while allowing explicit disconnection", async () => {
  const f = await fixture(), { connection } = await f.approve();
  // Only the connection expires at this fixture deadline; card, review and
  // material lifetimes remain valid to isolate the operation-specific rule.
  const expiresAt = new Date(f.now().getTime() + 1000).toISOString();
  f.notify({ topic: "fixture-topic", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet", expiresAt });
  const ready = await f.prepare(connection.connectionId), card = await f.createConnection();
  const preparations = vi.mocked(f.sessions.recordWalletConnected).mock.calls.length;
  f.advance(1000);
  expect((await f.read(ready.card)).snapshot.data).toMatchObject({ review: { status: "ready_for_wallet_review" } });
  expect(f.run(() => f.records.connection(connection.connectionId))?.connection.status).toBe("connected");
  expect((await f.act(card, { action: "use_account", connectionId: connection.connectionId, account: f.account })).error)
    .toEqual({ code: "card_conflict", message: "The selected wallet account is no longer available." });
  for (const action of ["prepare_review", "request_signature"]) {
    expect((await f.act(await f.read(ready.card), { action, connectionId: connection.connectionId,
      account: f.account, reviewRevision: ready.session.reviewRevision })).error)
      .toEqual({ code: "card_conflict", message: "The selected Sui wallet connection is unavailable." });
  }
  expect(vi.mocked(f.sessions.recordWalletConnected)).toHaveBeenCalledTimes(preparations);
  expect(f.run(() => f.records.currentRequest(ready.session.id))).toBeUndefined();
  expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  expect((await f.act(await f.read(card), { action: "disconnect", connectionId: connection.connectionId })).error).toBeUndefined();
  await vi.waitFor(() => expect(f.run(() => f.records.connection(connection.connectionId))).toMatchObject({
    sdkPending: false, connection: { status: "disconnected" }
  }));
  expect(f.transport.disconnect).toHaveBeenCalledOnce();
  expect((await f.read(card)).snapshot.state).toBe("closed");
});

it.each(["completed", "outcome_unknown"] as const)("does not reopen %s when the submission callback arrives late", async (outcome) => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  const submission = deferred<object>(); f.submit.mockImplementationOnce(() => submission.promise);
  await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: 1 });
  await vi.waitFor(() => expect(f.submit).toHaveBeenCalledOnce());
  const request = f.run(() => f.records.currentRequest(ready.session.id))!;
  if (outcome === "completed") {
    const result = await f.run(() => f.workflow.readReview(ready.session.id, true));
    expect(result?.request).toMatchObject({ requestStatus: "completed", transactionDigest: request.transactionDigest });
  } else {
    f.advance(599_999);
    expect((await f.run(() => f.localData.getDataCounts())).outcomeUnknownRequests).toBe(0);
    expect(f.run(() => f.records.request(request.attemptId)?.requestStatus)).toBe("submitting");
    f.advance(1);
    expect((await f.run(() => f.localData.getDataCounts())).outcomeUnknownRequests).toBe(1);
  }
  expect(f.run(() => f.records.authority(request.attemptId))).toMatchObject({ submit_pending: 1, sdk_pending: 1 });
  await expect(f.run(() => f.localData.resetLocalData())).rejects.toMatchObject({ details: { reason: "wallet_request_unsettled" } });
  const stored = f.run(() => f.records.request(request.attemptId)), deadline = f.run(() => f.records.authority(request.attemptId)?.lookup_deadline);
  submission.resolve({});
  await vi.waitFor(() => expect(f.run(() => f.records.authority(request.attemptId))).toMatchObject({ sdk_pending: 0, submit_pending: 0 }));
  expect(f.run(() => f.records.request(request.attemptId))).toEqual(stored);
  expect(f.run(() => f.records.authority(request.attemptId)?.lookup_deadline)).toBe(deadline);
  expect(f.run(() => f.records.busyForAccount(f.account, f.now()))).toBe(false);
  expect(f.submit).toHaveBeenCalledOnce(); expect(f.sign).toHaveBeenCalledOnce();
});

it("retains known request identity after a chain-result write fails and recovers it by reading", async () => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  const db = new Database(join(f.directory, "activity.sqlite"));
  try {
    db.exec("CREATE TRIGGER reject_result BEFORE INSERT ON review_executions BEGIN SELECT RAISE(ABORT,'PRIVATE-RESULT'); END");
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: 1 });
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe("outcome_unknown"));
    const request = f.run(() => f.records.currentRequest(ready.session.id))!;
    expect(request.execution).toBeUndefined();
    db.exec("DROP TRIGGER reject_result");
    expect((await f.run(() => f.workflow.readReview(ready.session.id, true)))?.request)
      .toMatchObject({ requestStatus: "completed", execution: { txDigest: request.transactionDigest, status: "success" } });
    expect(f.submit).toHaveBeenCalledOnce(); expect(f.chainRead).toHaveBeenCalledTimes(2);
  } finally { db.exec("DROP TRIGGER IF EXISTS reject_result"); db.close(); }
});

it("keeps a failed callback-settlement write protected until owner recovery, without replay", async () => {
  const f = await fixture(), { connection } = await f.approve(), ready = await f.prepare(connection.connectionId);
  const db = new Database(join(f.directory, "activity.sqlite"));
  try {
    db.exec("CREATE TRIGGER reject_settle BEFORE UPDATE OF submit_pending ON live_request_authority WHEN OLD.submit_pending=1 AND NEW.submit_pending=0 BEGIN SELECT RAISE(ABORT,'PRIVATE-SETTLE'); END");
    await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: 1 });
    await vi.waitFor(() => expect(f.logger.error).toHaveBeenCalledWith("Wallet operation failed", { stage: "signature_request" }));
    const request = f.run(() => f.records.currentRequest(ready.session.id))!;
    db.exec("DROP TRIGGER reject_settle");
    expect((await f.run(() => f.workflow.readReview(ready.session.id, true)))?.request?.requestStatus).toBe("completed");
    expect(f.run(() => f.records.authority(request.attemptId)?.submit_pending)).toBe(1);
    await expect(f.run(() => f.localData.resetLocalData())).rejects.toMatchObject({ details: { reason: "wallet_request_unsettled" } });
    f.workflow.stop(); const next = f.activity.createWalletWorkflowStore("replacement", f.now);
    f.run(() => next.recover(f.now()));
    expect(f.run(() => next.request(request.attemptId)?.requestStatus)).toBe("completed");
    expect(f.run(() => next.authority(request.attemptId))).toMatchObject({ submit_pending: 0, can_submit: 0 });
    expect(f.submit).toHaveBeenCalledOnce();
  } finally { db.exec("DROP TRIGGER IF EXISTS reject_settle"); db.close(); }
});

it("preserves a backend connection-expiry reason after signature verification", async () => {
  const f = await fixture(), { connection } = await f.approve();
  // A short synthetic connection lifetime isolates this guard from the longer
  // signing, review and quote deadlines; it is not a product timeout.
  f.notify({ topic: "fixture-topic", accounts: [f.account], methods: ["sui_signTransaction"], chain: "sui:mainnet",
    expiresAt: new Date(f.now().getTime() + 1000).toISOString() });
  const ready = await f.prepare(connection.connectionId);
  f.verifyNetwork.mockImplementationOnce(async () => { f.advance(1000); });
  await f.act(ready.card, { action: "request_signature", connectionId: connection.connectionId, account: f.account, reviewRevision: 1 });
  await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(ready.session.id)?.requestStatus)).toBe("request_failed"));
  expect(f.run(() => f.records.currentRequest(ready.session.id)?.reason)).toBe("The selected Sui wallet connection is unavailable.");
  expect(f.submit).not.toHaveBeenCalled(); expect(f.sign).toHaveBeenCalledOnce();
});
