import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { RuntimeDataAccess } from "../src/runtime/shared/dataAccess.js";

describe("shared-server data generations", () => {
  it("refuses reads and writes from an old asynchronous operation and from outside server dispatch", async () => {
    const access = new RuntimeDataAccess();
    const raw = new Database(":memory:");
    const db = access.guardDatabase(raw);
    db.exec("CREATE TABLE values_for_test (value TEXT NOT NULL)");
    access.ready();
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => { finish = resolve; });
    const late = access.run(async () => { const insert = db.prepare("INSERT INTO values_for_test VALUES (?)"); await wait; insert.run("stale"); });
    access.run(() => {
      db.transaction(() => db.prepare("INSERT INTO values_for_test VALUES (?)").run("replacement")).immediate();
      access.dataReplaced();
    });
    finish();
    await expect(late).rejects.toThrow("stale access");
    expect(() => db.prepare("SELECT value FROM values_for_test")).toThrow("stale access");
    expect(access.run(() => db.prepare("SELECT value FROM values_for_test").all())).toEqual([{ value: "replacement" }]);
    access.close();
    expect(() => access.run(() => db.prepare("SELECT value FROM values_for_test").all())).toThrow("closed");
    db.close();
  });
});
