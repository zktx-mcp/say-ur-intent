import Database from "better-sqlite3";
import { existsSync, lstatSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export class DataDirectoryOwnedError extends Error {
  readonly code = "DATA_DIRECTORY_OWNED";
}
/** An OS-released ownership lock, separate from the product database. No
 * business transaction is held while waiting for a wallet or network reply. */
export function acquireDataDirectoryOwner(databasePath: string): { close(): void } {
  const directory = dirname(databasePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = statSync(directory);
  if (!directoryStat.isDirectory() || (process.platform !== "win32" && ((directoryStat.mode & 0o077) !== 0 ||
      (process.getuid !== undefined && directoryStat.uid !== process.getuid())))) {
    throw new Error("The runtime data directory must be private to the current OS user.");
  }
  const filename = join(directory, "runtime-owner.sqlite");
  if (existsSync(filename)) {
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" &&
        ((stat.mode & 0o077) !== 0 || (process.getuid !== undefined && stat.uid !== process.getuid())))) {
      throw new Error("Runtime ownership file is not private to this OS user.");
    }
  }
  const mask = process.umask(0o077);
  let lock: Database.Database;
  try { lock = new Database(filename, { timeout: 0 }); } finally { process.umask(mask); }
  try {
    // A second owner is refused immediately, including one using another port.
    // SQLite retains the EXCLUSIVE lock after commit until this handle closes.
    lock.pragma("locking_mode=EXCLUSIVE");
    lock.exec("BEGIN EXCLUSIVE");
    lock.exec("CREATE TABLE IF NOT EXISTS owner_lock (singleton INTEGER PRIMARY KEY CHECK (singleton=1))");
    lock.exec("COMMIT");
  } catch (error) {
    lock.close();
    if (typeof error === "object" && error !== null && "code" in error && error.code === "SQLITE_BUSY") {
      throw new DataDirectoryOwnedError("This data directory already has a runtime owner. Use the same port for its clients, or a different data directory.");
    }
    throw new Error("The runtime data directory could not be locked.");
  }
  return { close: () => { if (lock.open) lock.close(); } };
}
