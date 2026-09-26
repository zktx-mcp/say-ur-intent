import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { CARD_RESOURCE_URIS } from "../src/mcp-ui/contracts.js";
import { TOOL_NAMES } from "../src/mcp/toolNames.js";
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from "@modelcontextprotocol/sdk/shared/protocol.js";
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

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { name: string; version: string; mcpName: string };

const requiredFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/runtime/start.js",
  ...["account", "receipt", "chart", "connect", "review"].flatMap((kind) => [`dist/mcp-app/${kind}.html`, `dist/mcp-app/${kind}.notices.txt`]),
  "LICENSES/@mysten-sui-2.17.0-Apache-2.0.txt",
  "dist/review-app/settings.js",
  "dist/review-app/settings.css",
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
  "registry/generated/",
  "submission/",
  "dist/review-app/connect."
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

export function assertPackContents(packInfo: PackInfo): void {
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


  const startJs = readFileSync("dist/runtime/start.js", "utf8");
  if (!startJs.startsWith("#!/usr/bin/env node")) {
    throw new Error("dist/runtime/start.js must keep the node shebang.");
  }
}

async function smokeInstallPackedTarball(tarballPath: string): Promise<void> {
  const installDir = mkdtempSync(join(tmpdir(), "say-ur-intent-install-"));
  let runtimeOwnsCleanup = false;
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
    runtimeOwnsCleanup = true;
    await smokeInstalledRuntime(installDir, binPath);
  } finally {
    if (!runtimeOwnsCleanup) rmSync(installDir, { recursive: true, force: true });
  }
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
  const address = server.address();
  await new Promise<void>((yes, no) => server.close((error) => error ? no(error) : yes()));
  if (!address || typeof address === "string") throw new Error("Could not reserve a smoke-test port.");
  // Runtime identity checks refuse a different process if the port is taken
  // between this reservation and startup; the smoke must fail in that case.
  return address.port;
}

async function smokeInstalledRuntime(installDir: string, binPath: string): Promise<void> {
  let transport: StdioClientTransport | undefined;
  let client: Client | undefined;
  let stage = "startup/mainnet prerequisites";
  try {
    const port = await unusedPort();
    transport = new StdioClientTransport({ command: process.execPath, args: [binPath], cwd: installDir,
      env: { SUI_NETWORK: "mainnet", SAY_UR_INTENT_DATA_DIR: join(installDir, "runtime-data"), SAY_UR_INTENT_REVIEW_PORT: String(port),
        ...(process.env.SUI_GRPC_URL ? { SUI_GRPC_URL: process.env.SUI_GRPC_URL } : {}),
        ...(process.env.SUI_GRAPHQL_URL ? { SUI_GRAPHQL_URL: process.env.SUI_GRAPHQL_URL } : {}) }, stderr: "pipe" });
    // Drain SDK diagnostics without publishing a project identifier or token.
    transport.stderr?.on("data", () => {});
    client = new Client({ name: "installed-package-check", version: manifest.version }, {
      capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } }
    });
    await client.connect(transport);
    if (client.getServerVersion()?.version !== manifest.version) throw new Error("Installed server version mismatch.");
    stage = "MCP tools and resources";
    const tools = await client.listTools();
    for (const name of [TOOL_NAMES.readGetServerStatus, TOOL_NAMES.sessionCreateWalletConnection,
      TOOL_NAMES.actionPrepareSuiActionReview, TOOL_NAMES.uiOpenAccount, TOOL_NAMES.uiOpenReceipt,
      TOOL_NAMES.uiOpenChart, TOOL_NAMES.settingsCreateLocalSettingsSession]) {
      if (!tools.tools.some((tool) => tool.name === name)) throw new Error(`Installed tool is missing: ${name}`);
    }
    const listed = await client.listResources();
    const expected = [...MCP_RESOURCES.map((resource) => resource.uri), ...Object.values(CARD_RESOURCE_URIS)];
    if (listed.resources.length !== expected.length || listed.resources.some((resource) => !expected.includes(resource.uri as typeof expected[number]))) {
      throw new Error("Installed resources differ from the product resource contract.");
    }
    for (const uri of expected) {
      if (!listed.resources.some((resource) => resource.uri === uri)) throw new Error(`Installed resource is missing: ${uri}`);
      const read = await client.readResource({ uri });
      if (!read.contents.some((item) => "text" in item && item.text.trim().length > 0)) throw new Error(`Installed resource is empty: ${uri}`);
    }
    stage = "Settings page and assets";
    const result = await client.callTool({ name: TOOL_NAMES.settingsCreateLocalSettingsSession, arguments: {} });
    const body = result.structuredContent as { ok?: boolean; data?: { settingsUrl?: string } } | undefined;
    if (result.isError || body?.ok !== true || !body.data?.settingsUrl) throw new Error("Installed Settings session could not be created.");
    const settings = new URL(body.data.settingsUrl);
    if (settings.origin !== `http://127.0.0.1:${port}` || !settings.pathname.startsWith("/settings/")) throw new Error("Unexpected installed Settings origin.");
    const get = async (path: string, headers?: Record<string, string>) => {
      const response = await fetch(new URL(path, settings.origin), { ...(headers ? { headers } : {}),
        signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MSEC), redirect: "error" });
      if (!response.ok) throw new Error(`Installed Settings response failed: ${response.status}`);
      return response;
    };
    const html = await (await get(settings.pathname)).text();
    if (!html.includes('id="settings-app"')) throw new Error("Installed Settings shell is missing.");
    for (const asset of ["settings.js", "settings.css", "ui.css", "favicon.svg", "brand-light.svg", "brand-dark.svg"]) {
      if (!(await (await get(`/review-assets/${asset}`)).text()).trim()) throw new Error(`Installed asset is empty: ${asset}`);
    }
    const status = await (await get(`/api${settings.pathname}`, { "x-say-ur-intent-token": settings.hash.slice(1) })).json() as { server?: { version?: string; network?: string } };
    if (status.server?.version !== manifest.version || status.server.network !== "mainnet") throw new Error("Installed Settings server metadata mismatch.");
    process.stderr.write("Installed package MCP, card resources and Settings checks passed.\n");
  } catch (error) {
    throw new Error(`Installed package check failed at ${stage}. Startup requires reachable Sui mainnet endpoints.`, { cause: error });
  } finally {
    if (transport && transport.pid !== null) {
      // The pinned SDK may return just after SIGKILL. Wait for its real child
      // close event before removing this installation and data directory.
      const closingTransport = transport;
      const closed = new Promise<void>((resolve) => {
        const previous = closingTransport.onclose;
        closingTransport.onclose = () => { previous?.(); resolve(); };
      });
      await client?.close();
      await closed;
    } else await client?.close();
    rmSync(installDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const server = JSON.parse(readFileSync("server.json", "utf8"));
  if (lock.name !== manifest.name || lock.version !== manifest.version || lock.packages?.[""]?.name !== manifest.name ||
      lock.packages?.[""]?.version !== manifest.version || server.version !== manifest.version || server.name !== manifest.mcpName ||
      server.packages?.[0]?.identifier !== manifest.name || server.packages?.[0]?.version !== manifest.version) {
    throw new Error("Release package, lockfile and MCP Registry metadata must agree before checking the release.");
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
    await smokeInstallPackedTarball(resolve(packDir, packedInfo.filename));
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }

  process.stderr.write("Release check passed.\n");

}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
