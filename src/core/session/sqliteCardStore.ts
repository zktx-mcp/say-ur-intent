import type { SqliteDatabase } from "../activity/sqliteActivityStoreTypes.js";
import { cardStateSchema, receiptDisplaySchema, type CardRecord, type CardRecordStore } from "./cardSession.js";

type Row = {
  id: string; owner_id: string; token_hash: string; kind: string;
  state: string; reason: string | null; error: string | null; revision: number;
  created_at: string; expires_at: string; input_json: string;
  accepted_input_json: string | null; result_json: string | null; receipt_display_json: string | null;
};

export class SqliteCardRecordStore implements CardRecordStore {
  constructor(private readonly db: SqliteDatabase) {}

  get(id: string): CardRecord | undefined {
    const row = this.db.prepare("SELECT * FROM live_read_cards WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    return {
      state: cardStateSchema.parse({ cardId: row.id, kind: row.kind, state: row.state, revision: row.revision,
        createdAt: row.created_at, expiresAt: row.expires_at, input: JSON.parse(row.input_json),
        ...(row.reason === null ? {} : { reason: row.reason }), ...(row.error === null ? {} : { error: row.error }),
        ...(row.result_json === null ? {} : { data: JSON.parse(row.result_json) }) }),
      tokenHash: row.token_hash, ownerId: row.owner_id,
      ...(row.accepted_input_json === null ? {} : { acceptedInput: JSON.parse(row.accepted_input_json) as Record<string, unknown> }),
      ...(row.receipt_display_json === null ? {} : { receiptDisplay: receiptDisplaySchema.parse(JSON.parse(row.receipt_display_json)) })
    };
  }
  create(record: CardRecord): void {
    this.db.prepare(`INSERT INTO live_read_cards
      (id, owner_id, token_hash, kind, state, reason, error, revision, created_at, expires_at,
       input_json, accepted_input_json, result_json, receipt_display_json)
      VALUES (@id, @owner, @token, @kind, @state, @reason, @error, @revision, @created, @expires,
       @input, @accepted, @result, @display)`).run(values(record));
  }
  replace(expected: CardRecord, next: CardRecord): boolean {
    // This single statement commits admission or a result atomically. A removed
    // card is never recreated by a delayed network response.
    return this.db.prepare(`UPDATE live_read_cards SET state=@state, reason=@reason, error=@error,
      revision=@revision, input_json=@input, accepted_input_json=@accepted, result_json=@result,
      receipt_display_json=@display
      WHERE id=@id AND owner_id=@owner AND token_hash=@token AND revision=@expectedRevision
        AND state=@expectedState`).run({ ...values(next), expectedRevision: expected.state.revision,
          expectedState: expected.state.state }).changes === 1;
  }
  recover(ownerId: string, now: Date): void {
    this.db.prepare(`UPDATE live_read_cards SET
      reason=CASE WHEN state='ready' AND expires_at<=@now THEN 'expired' ELSE 'server_restarted' END,
      state='closed', revision=revision+1, owner_id=@owner
      WHERE state!='closed' AND owner_id!=@owner`).run({ owner: ownerId, now: now.toISOString() });
  }
}

function values(record: CardRecord) {
  const state = cardStateSchema.parse(record.state);
  return { id: state.cardId, owner: record.ownerId, token: record.tokenHash, kind: state.kind,
    state: state.state, reason: state.reason ?? null, error: state.error ?? null, revision: state.revision,
    created: state.createdAt, expires: state.expiresAt, input: JSON.stringify(state.input),
    accepted: record.acceptedInput === undefined ? null : JSON.stringify(record.acceptedInput),
    result: state.data === undefined ? null : JSON.stringify(state.data),
    display: record.receiptDisplay === undefined ? null : JSON.stringify(receiptDisplaySchema.parse(record.receiptDisplay)) };
}
