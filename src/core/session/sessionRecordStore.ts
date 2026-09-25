import { isDeepStrictEqual } from "node:util";
import type { ReviewSession } from "../action/types.js";
import { cloneLocalSession } from "./localSession.js";

/** Persistent review preparation records. Transaction admission and request
 * authority are committed by the shared SQLite owner, separately from UI reads. */
export interface SessionRecordStore {
  readonly usesActivityStoreLiveSessionMutations?: boolean;
  get(id: string): ReviewSession | undefined;
  revision(id: string): number | undefined;
  hasAdmittedRevision(id: string, reviewRevision: number): boolean;
  create(id: string, session: ReviewSession): void;
  commitReviewSessionTransition(id: string, expected: ReviewSession, next: ReviewSession): boolean;
  ids(): string[];
  clear(): void;
  hasUnsettledRequest(id: string, now: Date): boolean;

}

export class InMemorySessionRecordStore implements SessionRecordStore {
  private readonly sessions = new Map<string, ReviewSession>();
  private readonly revisions = new Map<string, number>();
  readonly usesActivityStoreLiveSessionMutations = false;

  get(id: string): ReviewSession | undefined {
    const session = this.sessions.get(id);
    return session ? cloneLocalSession(session) : undefined;
  }

  revision(id: string): number | undefined { return this.revisions.get(id); }
  hasAdmittedRevision(_id: string, _reviewRevision: number): boolean { return false; }

  create(id: string, session: ReviewSession): void {
    if (this.sessions.has(id)) {
      throw new Error(`Review session already exists: ${id}`);
    }
    this.sessions.set(id, cloneLocalSession(session));
    this.revisions.set(id, 0);
  }

  commitReviewSessionTransition(id: string, expected: ReviewSession, next: ReviewSession): boolean {
    const current = this.sessions.get(id);
    if (!current || !isDeepStrictEqual(current, expected)) {
      return false;
    }
    this.sessions.set(id, cloneLocalSession(next));
    this.revisions.set(id, this.revisions.get(id)! + 1);
    return true;
  }

  ids(): string[] {
    return [...this.sessions.keys()];
  }

  clear(): void {
    this.sessions.clear();
    this.revisions.clear();
  }

  hasUnsettledRequest(_id: string, _now: Date): boolean {
    // This preparation-only fixture owns no wallet request records.
    return false;
  }
}
