import { AsyncLocalStorage } from "node:async_hooks";
import type { SqliteDatabase } from "../../core/activity/sqliteActivityStoreTypes.js";

// An asynchronous read may finish after import/reset. Its original generation
// remains attached to the continuation and cannot read or write the replacement DB.
export class RuntimeDataAccess {
  private readonly context = new AsyncLocalStorage<{ generation: number }>();
  private generation = 0;
  private initializing = true;
  private closed = false;

  run<T>(work: () => T): T {
    if (this.closed) throw new Error("Shared server is closed.");
    return this.context.run({ generation: this.generation }, work);
  }
  ready(): void { this.initializing = false; }
  assertCurrent = (): void => {
    const context = this.context.getStore();
    if (this.closed || (context === undefined ? !this.initializing : context.generation !== this.generation)) {
      throw new Error("Shared data changed or its server stopped; stale access is refused.");
    }
  };
  dataReplaced(): void {
    this.assertCurrent();
    this.generation += 1;
    const active = this.context.getStore();
    if (active !== undefined) active.generation = this.generation;
  }
  close(): void { this.closed = true; }

  guardDatabase = (database: SqliteDatabase): SqliteDatabase => {
    const guard = this.assertCurrent;
    return new Proxy(database, {
      get(target, property) {
        if (property === "prepare") return (sql: string) => {
          guard();
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(stmt, key) {
              const value: unknown = Reflect.get(stmt, key, stmt);
              return typeof value === "function" ? (...args: unknown[]) => {
                guard(); return Reflect.apply(value, stmt, args);
              } : value;
            }
          });
        };
        if (property === "transaction") return (work: (...args: never[]) => unknown) => {
          guard();
          return target.transaction((...args: never[]) => { guard(); return work(...args); });
        };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? (...args: unknown[]) => {
          if (property !== "close") guard();
          return Reflect.apply(value, target, args);
        } : value;
      }
    });
  };
}
