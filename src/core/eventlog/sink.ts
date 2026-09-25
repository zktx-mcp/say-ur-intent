import { appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export type EventLogRecord = {
  type:
    | "session.created"
    | "wallet.connected"
    | "settings_session.created"
    | "local_sessions.invalidated"
    | "state.computed"
    | "handoff.refused";
  sessionId: string;
  planId?: string;
  walletAddressHash?: string;
  txDigest?: string;
  status?: string;
  reason?: string;
  at: string;
};

export interface EventLogSink {
  append(record: EventLogRecord): Promise<void>;
}

export class NullEventLogSink implements EventLogSink {
  async append(_record: EventLogRecord): Promise<void> {}
}

export class NdjsonEventLogSink implements EventLogSink {
  constructor(private readonly filePath: string) {}

  async append(record: EventLogRecord): Promise<void> {
    await appendFile(this.filePath, `${JSON.stringify(redactEvent(record))}\n`, "utf8");
  }
}

export function redactEvent(record: EventLogRecord): EventLogRecord {
  const redacted: EventLogRecord = {
    type: record.type,
    sessionId: record.sessionId,
    at: record.at
  };
  if (record.planId) redacted.planId = record.planId;
  if (record.walletAddressHash) redacted.walletAddressHash = record.walletAddressHash;
  if (record.txDigest) redacted.txDigest = record.txDigest;
  if (record.status) redacted.status = record.status;
  if (record.reason) redacted.reason = record.reason;
  return redacted;
}

export function hashEventValue(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
