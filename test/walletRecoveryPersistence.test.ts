import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { WalletSdkProcess } from "../src/runtime/walletSdkProcess.js";
import type { WalletCommand, WalletEvent } from "../src/runtime/walletSdkIpc.js";
import { workflowViewSchema } from "../src/core/session/workflowView.js";
import { waitForWalletConnection } from "../src/core/session/wait.js";
import { walletWorkflowFixture } from "./fixtures/walletWorkflow.js";

// Only the OS/IPC peer is synthetic. Admission, supervisor, Workflow, SQLite,
// projection and waits are the product path. Real SDK/process integration is separate.
class Peer extends EventEmitter {
  connected = true; pid = 123; exitCode: number | null = null; signalCode: string | null = null;
  killMode: "exit" | "false" | "throw" | "hold" = "exit";
  kills = 0; commands: WalletCommand[] = [];
  constructor(private readonly startup: "ready" | "fail" | "hold") { super(); }
  send(command: WalletCommand, callback: (error: Error | null) => void) {
    this.commands.push(command); callback(null);
    if (command.type !== "init") throw new Error("Unexpected wallet command in the persistence fixture");
    if (this.startup === "hold") return true;
    queueMicrotask(() => this.emit("message", this.startup === "fail"
      ? { protocolVersion: 1, runId: command.runId, type: "failure", reason: "initialization_failed" } satisfies WalletEvent
      : { protocolVersion: 1, runId: command.runId, type: "snapshot", ready: true,
        snapshot: { runId: command.runId, sequence: 1, observedAt: new Date().toISOString(), sessions: [] } } satisfies WalletEvent));
    return true;
  }
  kill() {
    this.kills++;
    if (this.killMode === "throw") throw new Error("Fixture signal failure");
    if (this.killMode === "false") return false;
    if (this.killMode === "exit") queueMicrotask(() => this.finish());
    return true;
  }
  finish() { if (this.signalCode) return; this.connected = false; this.signalCode = "SIGKILL"; this.emit("exit", null, "SIGKILL"); }
}
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
  const peers: Peer[] = [], startups: ("ready" | "fail" | "hold")[] = [];
  const f = await walletWorkflowFixture({ createRuntime: (directory) => new WalletSdkProcess({ dataDirectory: directory,
    projectId: "0".repeat(32), metadata: { name: "Fixture", description: "Synthetic OS peer", url: "https://example.invalid" },
    spawn: () => { const peer = new Peer(startups.shift() ?? "ready"); peers.push(peer); return peer as unknown as ChildProcess; }
  }) });
  const db = new Database(join(f.directory, "activity.sqlite"));
  cleanup.push(async () => { for (const peer of peers) { peer.killMode = "exit"; peer.finish(); } await f.runtime.close(); db.close(); f.close(); });
  const manage = () => f.run(() => f.cards.create("connect", { intent: "manage" }));
  return { ...f, peers, startups, db, manage };
}

it("keeps a failed next-run reservation fenced until an explicit supervisor replacement", async () => {
  const f = await fixture(), prior = f.runtime.runId;
  f.runtime.fence(prior);
  await expect(f.runtime.replace(prior, () => { throw new Error("Fixture reservation failure"); })).rejects.toThrow("could not be confirmed");
  expect(f.runtime.availability().status).toBe("unavailable"); expect(f.peers).toHaveLength(1);
  expect(f.peers[0]!.signalCode).toBe("SIGKILL"); expect(() => f.runtime.bind()).toThrow();
  await f.manage(); await f.manage(); expect(f.peers).toHaveLength(1);
  // This retained supervisor primitive is not exposed through a card action.
  f.runtime.fence(prior); await f.runtime.replace(prior, () => {});
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect(f.peers).toHaveLength(2);
});

it.each(["false", "throw"] as const)("never spawns over a living child when termination returns %s", async (mode) => {
  const f = await fixture(), peer = f.peers[0]!, prior = f.runtime.runId;
  peer.killMode = mode; f.runtime.fence(prior);
  await expect(f.runtime.replace(prior, () => {})).rejects.toThrow("could not be confirmed");
  expect(peer.signalCode).toBeNull(); expect(f.runtime.availability().status).toBe("unavailable");
  await f.manage(); expect(peer.kills).toBe(1); expect(f.peers).toHaveLength(1);
  peer.killMode = "hold"; f.runtime.fence(prior);
  const replacing = f.runtime.replace(prior, () => {});
  expect(f.peers).toHaveLength(1); peer.finish(); await replacing;
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect(f.peers).toHaveLength(2);
});

it("retains service-loss publication until storage recovers, without repeating termination", async () => {
  const f = await fixture(), card = await f.manage();
  const connection = f.run(() => f.records.restoreConnection({ topic: "fixture-record", accounts: [f.account], methods: ["sui_signTransaction"],
    chain: "sui:mainnet", expiresAt: new Date(f.now().getTime() + 60000).toISOString() }, f.now())).connection;
  f.db.exec("CREATE TRIGGER reject_failure BEFORE UPDATE ON live_wallet_connections BEGIN SELECT RAISE(ABORT,'fixture failure write refused'); END");
  f.runtime.fail("wallet_state_unavailable");
  await vi.waitFor(() => expect(f.peers[0]!.signalCode).toBe("SIGKILL"));
  await expect(f.read(card)).rejects.toThrow("fixture failure write refused");
  expect(f.run(() => f.records.connection(connection.connectionId)?.connection.revision)).toBe(connection.revision);
  f.db.exec("DROP TRIGGER reject_failure");
  const current = await f.read(card), revision = f.run(() => f.records.connection(connection.connectionId)?.connection.revision);
  expect(workflowViewSchema.parse(current.snapshot.data).walletAvailability.status).toBe("unavailable");
  expect(revision).toBeGreaterThan(connection.revision);
  await f.read(card); expect(f.run(() => f.records.connection(connection.connectionId)?.connection.revision)).toBe(revision);
  expect(f.peers).toHaveLength(1); expect(f.peers[0]!.kills).toBe(1);
});

it("does not let a cancelled replacement continue into a new data generation", async () => {
  const f = await fixture(), prior = f.runtime.runId, peer = f.peers[0]!;
  peer.killMode = "hold"; f.runtime.fence(prior);
  const replacing = f.runtime.replace(prior, () => {});
  const stopped = expect(replacing).rejects.toThrow("run ended");
  await f.run(() => f.localData.resetLocalData()); peer.finish(); await stopped;
  expect(f.peers).toHaveLength(1); expect(f.runtime.availability().status).toBe("unavailable");
});

it.each(["available", "failed", "superseded", "server_restarted"] as const)("reads a historical recovery %s without restoring its retired input", async (outcome) => {
  const f = await fixture(), card = await f.manage();
  const record = f.run(() => f.cardRecords.get(card.snapshot.cardId))!;
  f.run(() => f.cardRecords.replace(record, { ...record, acceptedInput: { action: "restart_wallet_service", walletRunId: f.runtime.runId },
    state: { ...record.state, revision: record.state.revision + 1, state: "closed", reason: outcome === "server_restarted" ? "server_restarted" : outcome === "available" ? "completed" : "failed",
      data: { kind: "wallet_service_recovery", priorRunId: f.runtime.runId, admittedAt: f.now().toISOString(), updatedAt: f.now().toISOString(), outcome } } }));
  const saved = await f.read(card);
  expect(saved.snapshot.data).toMatchObject({ runtimeRecovery: { outcome }, allowedActions: [], observe: false });
  expect((await f.run(() => waitForWalletConnection(f.cards, card.snapshot.cardId))).waitOutcome).toBe("status_reached");
  expect((await f.act(await f.read(card), { action: "restart_wallet_service" })).error?.code).toBe("invalid_card_input");
  expect(f.peers).toHaveLength(1); expect(f.peers[0]!.kills).toBe(0);
});
