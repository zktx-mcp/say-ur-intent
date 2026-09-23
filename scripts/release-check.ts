import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assertSqliteEngineAvailable } from "../src/core/activity/sqliteActivityStore.js";
import { MCP_RESOURCES } from "../src/mcp/resources.js";

type PackFile = {
  path: string;
};

type PackInfo = {
  filename: string;
  files: PackFile[];
};

const requiredFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/runtime/start.js",
  "dist/mcp-app/account.html",
  "dist/mcp-app/receipt.html",
  "dist/mcp-app/chart.html",
  "dist/review-app/connect.js",
  "dist/review-app/connect.css",
  "dist/review-app/ui.css",
  "dist/review-app/favicon.svg",
  "dist/review-app/brand-light.svg",
  "dist/review-app/brand-dark.svg",
  "docs/UTILITY_INDEX.md",
  ...MCP_RESOURCES.map((resource) => resource.path)
] as const;

const forbiddenPrefixes = [
  "src/",
  "test/",
  ".WORK/",
  "scripts/",
  "registry/generated/"
] as const;

function run(command: string, args: string[], cwd = process.cwd()): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function capture(command: string, args: string[], cwd = process.cwd()): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
  return result.stdout;
}

function parsePackOutput(output: string): PackInfo {
  const parsed = JSON.parse(output) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("Unexpected npm pack --json output shape.");
  }
  const [packInfo] = parsed as PackInfo[];
  if (!packInfo || !Array.isArray(packInfo.files)) {
    throw new Error("npm pack output did not include a files array.");
  }
  return packInfo;
}

function assertPackContents(packInfo: PackInfo): void {
  const paths = new Set(packInfo.files.map((file) => file.path));

  for (const required of requiredFiles) {
    if (!paths.has(required)) {
      throw new Error(`Packed tarball is missing required file: ${required}`);
    }
  }

  for (const file of paths) {
    for (const prefix of forbiddenPrefixes) {
      if (file.startsWith(prefix)) {
        throw new Error(`Packed tarball includes forbidden path: ${file}`);
      }
    }
  }
}

function assertLocalFiles(): void {
  if (!existsSync("LICENSE")) {
    throw new Error("LICENSE file is required before publishing.");
  }
  if (!existsSync("dist/runtime/start.js")) {
    throw new Error("dist/runtime/start.js is required before publishing.");
  }
  if (!existsSync("dist/review-app/connect.js")) {
    throw new Error("dist/review-app/connect.js is required before publishing.");
  }
  if (!existsSync("dist/review-app/connect.css")) {
    throw new Error("dist/review-app/connect.css is required before publishing.");
  }

  const startJs = readFileSync("dist/runtime/start.js", "utf8");
  if (!startJs.startsWith("#!/usr/bin/env node")) {
    throw new Error("dist/runtime/start.js must keep the node shebang.");
  }
}

function smokeInstallPackedTarball(tarballPath: string): void {
  const installDir = mkdtempSync(join(tmpdir(), "say-ur-intent-install-"));
  try {
    run(
      "npm",
      ["install", "--no-audit", "--no-fund", "--package-lock=false", tarballPath],
      installDir
    );

    const binPath = resolve(installDir, "node_modules/.bin/say-ur-intent");
    if (!existsSync(binPath)) {
      throw new Error("Packed install did not create node_modules/.bin/say-ur-intent.");
    }
    const stat = statSync(binPath);
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      throw new Error("Packed install bin path is neither a file nor a symlink.");
    }

    run(
      "node",
      [
        "-e",
        "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1);'); if (db.prepare('SELECT id FROM t').get().id !== 1) throw new Error('better-sqlite3 install smoke failed'); db.close();"
      ],
      installDir
    );
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
}

run("npm", ["run", "typecheck"]);
run("npm", ["test"]);
run("npm", ["run", "build"]);

assertLocalFiles();
assertSqliteEngineAvailable();

const dryRunInfo = parsePackOutput(capture("npm", ["pack", "--dry-run", "--json"]));
assertPackContents(dryRunInfo);

const packDir = mkdtempSync(join(tmpdir(), "say-ur-intent-pack-"));
try {
  const packedInfo = parsePackOutput(
    capture("npm", ["pack", "--json", "--pack-destination", packDir])
  );
  assertPackContents(packedInfo);
  smokeInstallPackedTarball(resolve(packDir, packedInfo.filename));
} finally {
  rmSync(packDir, { recursive: true, force: true });
}

process.stderr.write("Release check passed.\n");
