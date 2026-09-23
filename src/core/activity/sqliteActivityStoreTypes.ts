import type Database from "better-sqlite3";
import type { ZodType } from "zod";
import type { AdapterLifecycleValidator } from "../action/adapterLifecycleValidation.js";

export class ActivityStoreError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export type SqliteActivityStoreOptions = {
  databasePath: string;
  validateAdapterLifecycle: AdapterLifecycleValidator;
  guardDatabase?: ((database: SqliteDatabase) => SqliteDatabase) | undefined;
};

export type SqliteDatabase = Database.Database;
export type EvidenceSchema = ZodType<unknown>;
