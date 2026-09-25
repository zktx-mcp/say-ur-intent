export type SessionStoreErrorCode =
  | "active_account_not_set"
  | "input_invalid"
  | "invalid_session_transition"
  | "plan_not_in_session"
  | "session_expired"
  | "session_not_found"
  | "session_mismatch"
  | "handoff_unavailable"
  | "handoff_commitment_mismatch";

export class SessionStoreError extends Error {
  constructor(
    readonly code: SessionStoreErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}
