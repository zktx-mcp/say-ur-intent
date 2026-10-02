import { FixtureWalletRuntime } from "./fixtures/walletRuntime.js";
import { afterEach, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import { walletWorkflowFixture, deferred } from "./fixtures/walletWorkflow.js";
import { waitForWalletConnection } from "../src/core/session/wait.js";
import { workflowViewSchema } from "../src/core/session/workflowView.js";

const fixtures: Awaited<ReturnType<typeof walletWorkflowFixture>>[] = [];
async function fixture() { const f = await walletWorkflowFixture(); fixtures.push(f); return f; }
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); });
async function manage(f: Awaited<ReturnType<typeof fixture>>) { return f.run(() => f.cards.create("connect", { intent: "manage" })); }

it("invalidates a restart confirmation at connection admission before any SDK pairing response", async () => {
  const f = await fixture(), controls = await manage(f), connecting = await f.createConnection();
  const opening = deferred<Awaited<ReturnType<typeof f.connect>>>(); f.connect.mockImplementationOnce(() => opening.promise);
  const replace = vi.spyOn(f.runtime, "replace"), run = f.runtime.runId;
  expect(workflowViewSchema.parse(controls.snapshot.data).recoveryImpact?.connectionIds).toEqual([]);
  expect((await f.read(controls)).snapshot.revision).toBe(controls.snapshot.revision);
  expect((await f.read(controls)).snapshot.revision).toBe(controls.snapshot.revision);
  expect((await f.act(connecting, { action: "connect" })).error).toBeUndefined();
  expect(f.connect).toHaveBeenCalledOnce();
  const connectionId = f.run(() => f.cardRecords.get(connecting.snapshot.cardId)?.operationId)!;
  expect(f.run(() => f.records.connection(connectionId))).toMatchObject({ sdkPending: true, connection: { status: "awaiting_approval" } });
  expect(f.run(() => f.cardRecords.get(controls.snapshot.cardId)!.state.revision)).toBeGreaterThan(controls.snapshot.revision);
  const rejected = await f.act(controls, { action: "restart_wallet_service" });
  expect(rejected.error?.code).toBe("card_conflict"); expect(replace).not.toHaveBeenCalled(); expect(f.runtime.runId).toBe(run);
  expect(f.run(() => f.cardRecords.get(controls.snapshot.cardId)?.acceptedInput)).toBeUndefined();
  expect(f.run(() => f.records.connection(connectionId)?.connection.status)).toBe("awaiting_approval");
  const current = await f.read(controls);
  expect(workflowViewSchema.parse(current.snapshot.data).recoveryImpact?.connectionIds).toEqual([connectionId]);
  expect((await f.act(current, { action: "restart_wallet_service" })).error).toBeUndefined();
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect(replace).toHaveBeenCalledOnce(); expect(f.runtime.runId).not.toBe(run);
  expect(f.run(() => f.records.connection(connectionId)?.connection.status)).toBe("stopped");
  expect((await f.act(current, { action: "restart_wallet_service" })).error).toBeUndefined();
  expect(replace).toHaveBeenCalledOnce(); expect(f.connect).toHaveBeenCalledOnce();
  expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
});

it("rolls connection admission back if publishing its changed impact to another ready card fails", async () => {
  const f = await fixture(), controls = await manage(f), connecting = await f.createConnection();
  const db = new Database(join(f.directory, "activity.sqlite"));
  const controlId = controls.snapshot.cardId.replaceAll("'", "''");
  db.exec(`CREATE TRIGGER reject_impact_publication BEFORE UPDATE OF revision ON live_read_cards
    WHEN OLD.id='${controlId}' AND NEW.revision>OLD.revision BEGIN SELECT RAISE(ABORT,'fixture impact publication failure'); END`);
  try {
    await expect(f.act(connecting, { action: "connect" })).rejects.toThrow("fixture impact publication failure");
    expect(f.run(() => f.records.connections())).toEqual([]);
    expect(f.run(() => f.cardRecords.get(connecting.snapshot.cardId))).toMatchObject({ state: { state: "ready", revision: connecting.snapshot.revision } });
    expect(f.run(() => f.cardRecords.get(connecting.snapshot.cardId)?.acceptedInput)).toBeUndefined();
    expect(f.run(() => f.cardRecords.get(controls.snapshot.cardId)!.state.revision)).toBe(controls.snapshot.revision);
    expect(f.connect).not.toHaveBeenCalled();
    db.exec("DROP TRIGGER reject_impact_publication");
    const opening = deferred<Awaited<ReturnType<typeof f.connect>>>(); f.connect.mockImplementationOnce(() => opening.promise);
    expect((await f.act(connecting, { action: "connect" })).error).toBeUndefined(); expect(f.connect).toHaveBeenCalledOnce();
    expect((await f.act(controls, { action: "restart_wallet_service" })).error?.code).toBe("card_conflict");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  } finally { db.exec("DROP TRIGGER IF EXISTS reject_impact_publication"); db.close(); }
});

it("keeps the existing signature-admission producer bound to a fresh restart confirmation", async () => {
  const f = await fixture(), { connection } = await f.approve(), review = await f.prepare(connection.connectionId);
  const controls = await manage(f), pending = deferred<Awaited<ReturnType<typeof f.sign>>>();
  f.sign.mockImplementationOnce(() => pending.promise);
  const replace = vi.spyOn(f.runtime, "replace");
  expect((await f.act(review.card, { action: "request_signature", connectionId: connection.connectionId,
    account: f.account, reviewRevision: review.session.reviewRevision })).error).toBeUndefined();
  await vi.waitFor(() => expect(f.sign).toHaveBeenCalledOnce());
  const request = f.run(() => f.records.currentRequest(review.session.id))!;
  const rejected = await f.act(controls, { action: "restart_wallet_service" });
  expect(rejected.error?.code).toBe("card_conflict"); expect(replace).not.toHaveBeenCalled();
  expect(workflowViewSchema.parse(rejected.snapshot.data).recoveryImpact?.attemptIds).toEqual([request.attemptId]);
  expect(f.run(() => f.records.authority(request.attemptId)?.can_submit)).toBe(1);
  expect(f.submit).not.toHaveBeenCalled();
});

it("rejects a later connection when restart wins admission first", async () => {
  const f = await fixture(), controls = await manage(f), connecting = await f.createConnection(), held = deferred<[]>();
  vi.spyOn(f.transport, "restore").mockImplementationOnce(() => held.promise);
  const replace = vi.spyOn(f.runtime, "replace");
  expect((await f.act(controls, { action: "restart_wallet_service" })).error).toBeUndefined();
  expect((await f.act(connecting, { action: "connect" })).error?.code).toBe("card_conflict");
  expect(f.connect).not.toHaveBeenCalled(); expect(f.run(() => f.records.connections())).toEqual([]);
  held.resolve([]); await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect(replace).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
});

it("admits one recovery for a run and never replays an accepted card after a lost reply", async () => {
  const f = await fixture(); await f.approve();
  const a = await manage(f), b = await manage(f), priorRun = f.runtime.runId;
  const replace = vi.spyOn(f.runtime, "replace");
  const input = { action: "restart_wallet_service", walletRunId: priorRun };
  const results = await Promise.all([f.act(a, input), f.act(b, input)]);
  expect(results.filter((result) => !result.error)).toHaveLength(1);
  expect(replace).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(f.runtime.runId).not.toBe(priorRun));
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  const repeated = await f.act(a, input);
  expect(repeated.error).toBeUndefined();
  expect(repeated.snapshot).toMatchObject({ state: "closed", reason: "completed", data: {
    runtimeRecovery: { priorRunId: priorRun, nextRunId: f.runtime.runId, outcome: "available" }, progress: { status: "idle" }, observe: false
  } });
  expect(replace).toHaveBeenCalledOnce(); expect(f.connect).toHaveBeenCalledOnce();
  expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  const fresh = await manage(f);
  expect((await f.act(fresh, input)).error?.code).toBe("card_conflict");
});

it("revokes a pending approval before recovery and rejects its late signature", async () => {
  const f = await fixture(), { connection } = await f.approve(), review = await f.prepare(connection.connectionId);
  const pending = deferred<Awaited<ReturnType<typeof f.sign>>>();
  f.sign.mockImplementationOnce(() => pending.promise);
  await f.act(review.card, { action: "request_signature", account: f.account, connectionId: connection.connectionId, reviewRevision: review.session.reviewRevision });
  await vi.waitFor(() => expect(f.sign).toHaveBeenCalledOnce());
  const request = f.run(() => f.records.currentRequest(review.session.id))!;
  const card = await manage(f);
  expect((await f.act(card, { action: "restart_wallet_service" })).error).toBeUndefined();
  expect(f.run(() => f.records.request(request.attemptId)?.requestStatus)).toBe("stopped");
  expect(f.run(() => f.records.authority(request.attemptId)?.can_submit)).toBe(0);
  const signed = await f.accountKey.signTransaction(Buffer.from(f.sign.mock.calls[0]![0].transactionBytesBase64, "base64"));
  pending.resolve({ transactionBytes: signed.bytes, signature: signed.signature });
  await vi.waitFor(() => expect(f.run(() => f.records.authority(request.attemptId)?.sdk_pending)).toBe(0));
  expect(f.submit).not.toHaveBeenCalled(); expect(f.sign).toHaveBeenCalledOnce();
});

it("keeps the real parent verification pending after child recovery until it actually returns", async () => {
  const f = await fixture(), { connection } = await f.approve(), review = await f.prepare(connection.connectionId);
  const gate = deferred<void>(); f.verifyNetwork.mockImplementationOnce(() => gate.promise);
  await f.act(review.card, { action: "request_signature", account: f.account, connectionId: connection.connectionId, reviewRevision: review.session.reviewRevision });
  await vi.waitFor(() => expect(f.verifyNetwork).toHaveBeenCalledOnce());
  const request = f.run(() => f.records.currentRequest(review.session.id))!;
  await f.act(await manage(f), { action: "restart_wallet_service" });
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect(f.run(() => f.records.authority(request.attemptId))).toMatchObject({ can_submit: 0, sdk_pending: 1 });
  await expect(f.run(() => f.localData.resetLocalData())).rejects.toThrow("unsettled");
  const nextReview = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
  const nextCard = await f.run(() => f.cards.create("review", { reviewSessionId: nextReview.session.id }));
  expect(nextCard.snapshot.data).toMatchObject({ allowedActions: ["cancel"], review: { accountRequestPending: true } });
  gate.resolve();
  await vi.waitFor(() => expect(f.run(() => f.records.authority(request.attemptId)?.sdk_pending)).toBe(0));
  expect((await f.read(nextCard)).snapshot.data).toMatchObject({ automaticAction: { action: "prepare_review", account: f.account } });
  expect(f.submit).not.toHaveBeenCalled();
});

it("continues the already dispatched transaction once, with its original chain observation", async () => {
  const f = await fixture(), { connection } = await f.approve(), review = await f.prepare(connection.connectionId);
  const submission = deferred<{}>(); f.submit.mockImplementationOnce(() => submission.promise);
  await f.act(review.card, { action: "request_signature", account: f.account, connectionId: connection.connectionId, reviewRevision: review.session.reviewRevision });
  await vi.waitFor(() => expect(f.submit).toHaveBeenCalledOnce());
  const request = f.run(() => f.records.currentRequest(review.session.id))!;
  const before = f.run(() => f.records.authority(request.attemptId))!;
  await f.act(await manage(f), { action: "restart_wallet_service" });
  expect(f.run(() => f.records.request(request.attemptId)?.requestStatus)).toBe("submitting");
  expect(f.run(() => f.records.authority(request.attemptId))).toMatchObject({ submit_pending: 1, lookup_deadline: before.lookup_deadline, observation_stopped: 0 });
  submission.resolve({});
  await vi.waitFor(() => expect(f.run(() => f.records.request(request.attemptId)?.requestStatus)).toBe("completed"));
  expect(f.run(() => f.records.request(request.attemptId)?.transactionDigest)).toBe(request.transactionDigest);
  expect(f.submit).toHaveBeenCalledOnce(); expect(f.sign).toHaveBeenCalledOnce();
});

it("reports ongoing SDK startup as recovery work even after the card input expires", async () => {
  const f = await fixture(), gate = deferred<[]>();
  vi.spyOn(f.transport, "restore").mockImplementationOnce(() => gate.promise);
  const card = await manage(f);
  await f.act(card, { action: "restart_wallet_service" });
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("initializing"));
  f.advance(Date.parse(card.snapshot.expiresAt) - f.now().getTime() + 1);
  const current = await f.read(card);
  expect(current.snapshot).toMatchObject({ state: "running", inputRemainingMs: 0,
    data: { observe: true, progress: { status: "waiting" }, runtimeRecovery: { phase: "starting" } } });
  expect(f.run(() => f.workflow.pendingConnections())).toEqual([expect.objectContaining({
    cardId: card.snapshot.cardId, status: "wallet_recovery_pending", progress: { status: "waiting" }
  })]);
  const waited = await f.run(() => waitForWalletConnection(f.cards, card.snapshot.cardId, { timeoutMs: 0 }));
  expect(waited.waitOutcome).toBe("timed_out");
  gate.resolve([]);
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect((await f.read(card)).snapshot.data).toMatchObject({ observe: false, runtimeRecovery: { outcome: "available" } });
});

it("does not terminate the SDK when atomic recovery admission rolls back", async () => {
  const f = await fixture(); await f.approve();
  const card = await manage(f), run = f.runtime.runId, replace = vi.spyOn(f.runtime, "replace");
  const db = new Database(join(f.directory, "activity.sqlite"));
  db.exec("CREATE TRIGGER reject_recovery BEFORE UPDATE ON live_wallet_connections BEGIN SELECT RAISE(ABORT,'fixture storage refusal'); END");
  try {
    await expect(f.act(card, { action: "restart_wallet_service" })).rejects.toThrow("fixture storage refusal");
    expect(replace).not.toHaveBeenCalled(); expect(f.runtime.runId).toBe(run);
    const unchanged = f.run(() => f.cardRecords.get(card.snapshot.cardId));
    expect(unchanged?.acceptedInput).toBeUndefined(); expect(unchanged?.state.state).toBe("ready");
    expect(f.runtime.availability().status).toBe("unavailable");
  } finally { db.exec("DROP TRIGGER reject_recovery"); db.close(); }
});

it("checks the SDK again after signature and mainnet verification, without relying on an earlier observation", async () => {
  const f = await fixture(), { connection } = await f.approve(), review = await f.prepare(connection.connectionId);
  const approved = f.transport.session("fixture-topic")!;
  f.verifyNetwork.mockImplementationOnce(async () => {
    // No event is sent. Only the required final check can see this change.
    vi.spyOn(f.transport, "session").mockReturnValue({ ...approved, accounts: [`0x${"b".repeat(64)}`] });
  });
  await f.act(review.card, { action: "request_signature", account: f.account, connectionId: connection.connectionId, reviewRevision: review.session.reviewRevision });
  await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(review.session.id)?.requestStatus)).toBe("stopped"));
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).not.toHaveBeenCalled();
});

it("supersedes a stalled replacement only through a new manage card and ignores the old startup completion", async () => {
  const f = await fixture(), held = deferred<[]>(), priorRun = f.runtime.runId;
  vi.spyOn(f.transport, "restore").mockImplementationOnce(() => held.promise);
  const first = await manage(f); await f.act(first, { action: "restart_wallet_service" });
  await vi.waitFor(() => expect(f.runtime.runId).not.toBe(priorRun));
  const secondRun = f.runtime.runId, second = await manage(f);
  await f.act(second, { action: "restart_wallet_service" });
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect(f.runtime.runId).not.toBe(secondRun);
  expect((await f.read(first)).snapshot).toMatchObject({ state: "closed", reason: "cancelled", data: { runtimeRecovery: { outcome: "superseded" } } });
  held.resolve([]); await new Promise((resolve) => setImmediate(resolve));
  expect((await f.read(first)).snapshot.data).toMatchObject({ runtimeRecovery: { outcome: "superseded" } });
  expect((await f.read(second)).snapshot.data).toMatchObject({ runtimeRecovery: { outcome: "available" } });
  expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
});

it("can commit reset while recovery startup is pending, without a late startup recreating removed records", async () => {
  const f = await fixture(), held = deferred<[]>();
  vi.spyOn(f.transport, "restore").mockImplementationOnce(() => held.promise);
  const card = await manage(f); await f.act(card, { action: "restart_wallet_service" });
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("initializing"));
  const runId = f.runtime.runId;
  await f.run(() => f.localData.resetLocalData());
  held.resolve([]); await new Promise((resolve) => setImmediate(resolve));
  expect(f.run(() => f.cardRecords.get(card.snapshot.cardId))).toBeUndefined();
  expect(f.runtime.runId).toBe(runId); expect(f.runtime.availability().status).toBe("unavailable");
  expect(f.connect).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled();
});

it("repairs a failed recovery result write on a current read without another SDK replacement", async () => {
  const f = await fixture(), replace = vi.spyOn(f.runtime, "replace"), db = new Database(join(f.directory, "activity.sqlite"));
  const card = await manage(f);
  db.exec("CREATE TRIGGER reject_recovery_result BEFORE UPDATE OF result_json ON live_read_cards WHEN json_extract(NEW.result_json,'$.outcome')='available' BEGIN SELECT RAISE(ABORT,'fixture result write failure'); END");
  try {
    await f.act(card, { action: "restart_wallet_service" });
    await vi.waitFor(() => expect(f.runtime.availability()).toMatchObject({ status: "initializing", stage: "state_sync" }));
    expect(f.run(() => f.cardRecords.get(card.snapshot.cardId)?.state.state)).toBe("running");
    db.exec("DROP TRIGGER reject_recovery_result");
    expect((await f.read(card)).snapshot).toMatchObject({ state: "closed", data: { runtimeRecovery: { outcome: "available" } } });
    expect(f.runtime.availability().status).toBe("available"); expect(replace).toHaveBeenCalledOnce();
  } finally { db.exec("DROP TRIGGER IF EXISTS reject_recovery_result"); db.close(); }
});

it("repairs finished wallet callback flags without repeating a signature or chain lookup", async () => {
  const f = await fixture(), { connection } = await f.approve(), review = await f.prepare(connection.connectionId);
  const db = new Database(join(f.directory, "activity.sqlite"));
  db.exec("CREATE TRIGGER reject_sdk_settle BEFORE UPDATE OF sdk_pending ON live_request_authority WHEN OLD.sdk_pending=1 AND NEW.sdk_pending=0 BEGIN SELECT RAISE(ABORT,'fixture callback write failure'); END");
  try {
    await f.act(review.card, { action: "request_signature", account: f.account, connectionId: connection.connectionId, reviewRevision: review.session.reviewRevision });
    await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(review.session.id)?.requestStatus)).toBe("completed"));
    const request = f.run(() => f.records.currentRequest(review.session.id))!, reads = f.chainRead.mock.calls.length;
    expect(f.run(() => f.records.authority(request.attemptId)?.sdk_pending)).toBe(1);
    db.exec("DROP TRIGGER reject_sdk_settle");
    expect((await f.run(() => f.workflow.readReview(review.session.id)))?.request).toEqual(request);
    expect(f.run(() => f.records.authority(request.attemptId)?.sdk_pending)).toBe(0);
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce(); expect(f.chainRead).toHaveBeenCalledTimes(reads);
  } finally { db.exec("DROP TRIGGER IF EXISTS reject_sdk_settle"); db.close(); }
});

it("never lets a pairing cleanup clear the pending flag owned by a later disconnect", async () => {
  const f = await fixture(), { card: connected, connection } = await f.approve(), pending = deferred<void>();
  vi.mocked(f.transport.disconnect).mockImplementationOnce(() => pending.promise);
  const card = await manage(f); await f.act(card, { action: "disconnect", connectionId: connection.connectionId });
  f.run(() => f.records.settleConnection(connection.connectionId, { cardId: connected.snapshot.cardId, runId: f.runtime.runId, action: "connect" }));
  expect(f.run(() => f.records.connection(connection.connectionId)?.sdkPending)).toBe(true);
  pending.resolve();
  await vi.waitFor(() => expect(f.run(() => f.records.connection(connection.connectionId)?.sdkPending)).toBe(false));
  expect(f.transport.disconnect).toHaveBeenCalledOnce();
});

it.each(["completed", "submitting"] as const)("keeps %s transaction facts independent of an unsaved wallet recovery failure", async (status) => {
  const f = await fixture(), { connection } = await f.approve(), review = await f.prepare(connection.connectionId);
  const submission = deferred<{}>(), startup = deferred<[]>();
  if (status === "submitting") f.submit.mockImplementationOnce(() => submission.promise);
  await f.act(review.card, { action: "request_signature", account: f.account, connectionId: connection.connectionId, reviewRevision: review.session.reviewRevision });
  await vi.waitFor(() => expect(f.run(() => f.records.currentRequest(review.session.id)?.requestStatus)).toBe(status));
  const request = f.run(() => f.records.currentRequest(review.session.id))!;
  vi.spyOn(f.transport, "restore").mockImplementationOnce(() => startup.promise);
  const card = await manage(f); await f.act(card, { action: "restart_wallet_service" });
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("initializing"));
  const db = new Database(join(f.directory, "activity.sqlite"));
  db.exec("CREATE TRIGGER reject_failure BEFORE UPDATE OF result_json ON live_read_cards WHEN json_extract(NEW.result_json,'$.outcome')='failed' BEGIN SELECT RAISE(ABORT,'fixture outcome failure'); END");
  try {
    f.runtime.fail("initialization_failed");
    await expect(f.read(card)).rejects.toThrow("fixture outcome failure");
    const saved = await f.run(() => f.workflow.readReview(review.session.id, true));
    expect(saved?.request).toMatchObject({ attemptId: request.attemptId, transactionDigest: request.transactionDigest,
      requestStatus: "completed", execution: { status: "success" } });
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce();
    if (status === "submitting") {
      expect(f.run(() => f.records.authority(request.attemptId))).toMatchObject({ sdk_pending: 1, submit_pending: 1 });
      await expect(f.run(() => f.localData.resetLocalData())).rejects.toThrow("unsettled");
    }
    db.exec("DROP TRIGGER reject_failure");
    expect((await f.read(card)).snapshot.data).toMatchObject({ runtimeRecovery: { outcome: "failed" } });
  } finally { submission.resolve({}); startup.resolve([]); db.exec("DROP TRIGGER IF EXISTS reject_failure"); db.close(); }
});

it("requires only its own lookup repair before admitting a new same-digest observation", async () => {
  const f = await fixture(), { connection } = await f.approve(), review = await f.prepare(connection.connectionId);
  const db = new Database(join(f.directory, "activity.sqlite")), chain = f.chainRead.getMockImplementation()!;
  f.chainRead.mockRejectedValue(new Error("Fixture chain response unavailable"));
  db.exec("CREATE TRIGGER refuse_lookup BEFORE UPDATE OF lookup_pending ON live_request_authority WHEN OLD.lookup_pending=1 AND NEW.lookup_pending=0 BEGIN SELECT RAISE(ABORT,'own lookup refused'); END");
  try {
    await f.act(review.card, { action: "request_signature", account: f.account, connectionId: connection.connectionId, reviewRevision: review.session.reviewRevision });
    await vi.waitFor(() => expect(f.logger.error).toHaveBeenCalled());
    const request = f.run(() => f.records.currentRequest(review.session.id))!;
    f.run(() => f.records.transitionRequest(request.attemptId, "outcome_unknown", f.now(), { reason: "Fixture observation window ended." }));
    const calls = f.chainRead.mock.calls.length;
    expect((await f.run(() => f.workflow.readReview(review.session.id)))?.request?.requestStatus).toBe("outcome_unknown");
    await expect(f.run(() => f.workflow.readReview(review.session.id, true))).rejects.toThrow("own lookup refused");
    expect(f.chainRead).toHaveBeenCalledTimes(calls);
    expect(f.run(() => f.records.authority(request.attemptId)?.lookup_pending)).toBe(1);
    await expect(f.run(() => f.localData.resetLocalData())).rejects.toThrow();
    db.exec("DROP TRIGGER refuse_lookup"); f.chainRead.mockImplementation(chain);
    expect((await f.run(() => f.workflow.readReview(review.session.id, true)))?.request?.requestStatus).toBe("completed");
    expect(f.submit).toHaveBeenCalledOnce();
  } finally { db.close(); }
});

it.each(["restart", "lost", "disconnect", "account"] as const)("preserves the concrete %s cause when invalidating a prepared review", async (cause) => {
  const f = await fixture(), { connection } = await f.approve(), review = await f.prepare(connection.connectionId);
  if (cause === "lost") (f.runtime as FixtureWalletRuntime).fail("initialization_failed");
  else if (cause === "account") f.notify({ ...f.transport.session("fixture-topic")!, accounts: [f.account, `0x${"b".repeat(64)}`] }, true);
  else await f.act(await manage(f), cause === "restart" ? { action: "restart_wallet_service" } : { action: "disconnect", connectionId: connection.connectionId });
  const snapshot = await f.read(review.card);
  const data = workflowViewSchema.parse(snapshot.snapshot.data);
  expect(data.review?.state?.refreshReason).toBe("wallet_connection_changed");
  const message = cause === "restart" ? "The wallet service was restarted." : cause === "lost" ? "The wallet service stopped." :
    cause === "disconnect" ? "Disconnection of the selected wallet was requested." : "The selected wallet connection changed.";
  expect(data.review?.error).toContain(message);
  const db = new Database(join(f.directory, "activity.sqlite"));
  try { expect(db.prepare("SELECT reason FROM review_status_transitions WHERE review_session_id=? AND event='review_invalidated' ORDER BY id DESC LIMIT 1").get(review.session.id)).toMatchObject({ reason: expect.stringContaining(message) }); }
  finally { db.close(); }
  expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
});

it.each(["restart", "lost"] as const)("retains the %s reason when an interrupted computation returns late", async (cause) => {
  const f = await fixture(), { connection } = await f.approve(), originalQuote = f.quote.getMockImplementation()!, held = deferred<void>();
  f.quote.mockImplementationOnce(async () => { await held.promise; return originalQuote(); });
  const { session } = await f.run(() => f.sessions.createReviewSession([f.plan], f.now()));
  const card = await f.run(() => f.cards.create("review", { reviewSessionId: session.id }));
  await f.act(card, { action: "prepare_review", account: f.account, connectionId: connection.connectionId, reviewRevision: 0 });
  await vi.waitFor(() => expect(f.quote).toHaveBeenCalledOnce());
  if (cause === "restart") await f.act(await manage(f), { action: "restart_wallet_service" });
  else (f.runtime as FixtureWalletRuntime).fail("initialization_failed");
  const before = f.run(() => f.sessions.readReviewSession(session.id))!;
  expect(before.preparationId).toBeUndefined();
  expect(before.preparationError).toContain(cause === "restart" ? "was restarted" : "stopped");
  held.resolve(); await vi.waitFor(() => expect(f.simulate).toHaveBeenCalled());
  expect(f.run(() => f.sessions.readReviewSession(session.id))?.preparationError).toBe(before.preparationError);
  expect(f.sign).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
});
