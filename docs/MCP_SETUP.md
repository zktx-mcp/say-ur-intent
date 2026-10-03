# MCP Setup

This is the setup guide for Say Ur Intent MCP clients. It owns installation, MCP client connection, first-use flow, local settings, and troubleshooting.

It does not define tool field contracts or response wording. Use `docs/MCP_TOOLS.md` for the MCP API reference and `docs/AGENT_BEHAVIOR.md` for the answer playbook.

The README keeps only the short entry path; client-specific setup, restart behavior, and troubleshooting live here.

Say Ur Intent is tested from a local checkout in this repository state.

The card and connection behavior described here includes unpublished checkout changes.
Installing `@zktx.io/say-ur-intent@0.4.4` does not select this checkout. Use the
local build configuration below to run these changes, or the documentation
bundled with your installed package to follow its supported flow. A development
build can retain the published version number; that number alone does not
identify the running build. Changing client settings or rebuilding local files
also does not replace an already running shared server. Restart the clients and
check the server's executable path when switching builds.

## Key terms

- Sui: the mainnet blockchain whose DeFi state this project reads.
- MCP: Model Context Protocol, the tool-calling interface used by AI clients.
- DeepBook: Sui's onchain order book protocol.
- SDK: Software Development Kit, a version-pinned library dependency used by this repository.
- gRPC and GraphQL: Sui SDK transports used by this runtime for mainnet reads.
- WalletConnect: the backend's transport for wallet-approved connections and individual transaction requests.
- stdio: standard input/output, the local transport used by MCP clients to talk to this server.
- `@zktx.io`: the npm package scope. `zktx-mcp` is the GitHub organization. Say Ur Intent is the product; `say-ur-intent` is the MCP server name and executable command.

## Requirements

- Node.js 22+. Node 22 or 24 LTS is recommended.
- An MCP client that can run a local stdio server.
- Network access to Sui mainnet gRPC for runtime startup validation and to Sui mainnet GraphQL for user-requested activity reads.

## Default Setup

No Sui endpoint setup is required for the default path. The runtime creates a local SQLite database automatically, stores default Sui mainnet gRPC and GraphQL endpoints there on first start, and uses those endpoints for read-only mainnet tools.

If you want a custom Sui gRPC or GraphQL provider, or local data controls, configure them after the MCP server is connected by asking your AI client to create a local settings session:

- "Show my Say Ur Intent local settings."
- "Open my Say Ur Intent local settings page."

Open the returned settings URL in the same machine's system browser. Custom endpoint changes apply after the MCP server restarts. Advanced temporary environment overrides are documented in [Advanced Runtime Settings](#advanced-runtime-settings).

DeepBook orderbook, raw-quantity quote, and display-amount quote reads use an internal mainnet SDK simulation sender placeholder.

They do not require wallet connection.

This placeholder is only the sender value required by DeepBook SDK simulation reads. It is not a user's wallet, signing authorization, or fake user liquidity.

Reads that require a connected default account use `session.create_wallet_connection`. Tools with an `account` input also accept an explicit Sui address without a wallet connection.

## Developer Checkout Setup

Use this path when you download the repository from GitHub and want to test the local build:

```bash
git clone https://github.com/zktx-mcp/say-ur-intent.git
cd say-ur-intent
npm install
npm run build
```

Generic stdio MCP configuration:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/say-ur-intent/dist/runtime/start.js"]
}
```

Do not wrap the MCP stdio command in a shell script that writes ordinary text to stdout.

On native Windows clients that need `cmd`, use the same command through `cmd /c`:

```json
{
  "command": "cmd",
  "args": ["/c", "node", "C:\\absolute\\path\\to\\say-ur-intent\\dist\\runtime\\start.js"]
}
```

To delegate local setup to an AI coding agent, tell it:

```text
Register this repository as a local stdio MCP server using the built /absolute/path/to/say-ur-intent/dist/runtime/start.js file.
Use the default Sui mainnet endpoint unless I explicitly ask for a custom provider.
```

## Commands

These `npm run` scripts run from a local checkout. They are developer and maintainer scripts, not MCP tools or packaged product commands:

```bash
npm install
npm run typecheck
npm run build
npm test
npm run release:check
npm run generate:deepbook-registry
npm run smoke:mainnet
```

`npm run generate:deepbook-registry` writes `registry/generated/deepbook-mainnet.json`, which is ignored by Git because generated registry data must include provenance and should be regenerated from the pinned SDK.

## Install from the MCP Registry

If your MCP client can install servers from the
[MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=say-ur-intent),
find the `io.github.zktx-mcp/say-ur-intent` entry and install it through your
client. The resulting stdio server command is equivalent to:

```sh
npx -y @zktx.io/say-ur-intent
```

Clients that do not install from the registry use the published-package and
per-client configuration below, which give the exact `command` and `args`.

## Published Package Setup

The npm package for this release is `@zktx.io/say-ur-intent`. The commands below
require the requested version to be published; confirm it with
`npm view @zktx.io/say-ur-intent@0.4.4 version` before switching. Both installation
methods start the same `say-ur-intent` stdio MCP server. Use a local checkout when
working on a version that has not been published.

### Download on demand (npx, tracks the latest release)

```json
{
  "command": "npx",
  "args": ["-y", "@zktx.io/say-ur-intent"]
}
```

No install step, and each launch resolves the latest published version. The
trade-off: the first launch (or the first after the npx cache is cleared)
downloads the package and its native dependencies. On a cold cache this can take
long enough to exceed a client's MCP startup timeout, so the client may stop the
server before it connects. If that happens, warm the cache once in a terminal and
then restart the client:

```bash
npx -y @zktx.io/say-ur-intent
# wait until it logs "review server started", then stop it with Ctrl-C
```

### Install once (global, fastest startup, pinned version)

```bash
npm install -g @zktx.io/say-ur-intent
```

```json
{
  "command": "say-ur-intent"
}
```

The global `say-ur-intent` command starts with no per-launch download, so it
avoids the cold-start timeout, and it stays on the installed version until you
update it explicitly:

```bash
npm install -g @zktx.io/say-ur-intent@latest
```

The per-client sections below use the `npx` form. To use a global install
instead, replace the published-package command with `"command": "say-ur-intent"`
and drop the `args`. On native Windows clients that need `cmd`, wrap either
command, for example `"command": "cmd", "args": ["/c", "npx", "-y", "@zktx.io/say-ur-intent"]`.

## Switching the Installed Package

These steps cover switching to 0.4.4 from 0.4.0–0.4.3, which use the same database
format. Confirm the new package version is available before changing
your client configuration. Keep the same data directory and shared review port
so the existing settings, wallet connection and stored results remain accessible.
This package update does not require deleting the database or repeating a
financial request.

Stop the old Say Ur Intent MCP processes in all connected clients and wait for
the shared backend to exit before starting the new package. Clients with the same runtime
configuration can otherwise attach to an older backend that is still running.
If a transaction request is in progress, inspect its state and coordinate a safe
restart first.

Replace the old registration instead of adding a second one. Use exactly
`say-ur-intent` for the registration name, and select the intended package version
in its command arguments, such as `@zktx.io/say-ur-intent@0.4.4`. Do not append an
environment label, version or numeric suffix. With a global install, verify that
`say-ur-intent` resolves to the intended installation.

After restarting the clients, call `read.get_server_status` in each. Check
`packageName`, `version` and `serverName`: they must identify the intended npm
package and version, with `serverName` equal to `say-ur-intent`. Then inspect the
existing connection and stored results. This check does not require signing or
submitting another transaction.

## Claude Code

Claude Code supports local stdio MCP servers through `claude mcp add`. Put Claude CLI options such as `--transport` and `--scope` before the server name; the `--` separator starts the command that runs Say Ur Intent.

Developer checkout:

```bash
claude mcp add --transport stdio \
  say-ur-intent \
  -- node /absolute/path/to/say-ur-intent/dist/runtime/start.js
```

Published npm package:

```bash
claude mcp add --transport stdio \
  say-ur-intent \
  -- npx -y @zktx.io/say-ur-intent
```

Claude Code scopes:

- `local`: default; private to the current project.
- `project`: shared through a checked-in `.mcp.json`.
- `user`: private to your user account and available across projects.

Project-scope `.mcp.json` example:

```json
{
  "mcpServers": {
    "say-ur-intent": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/say-ur-intent/dist/runtime/start.js"]
    }
  }
}
```

Verify the server and tool list:

```bash
claude mcp list
claude mcp get say-ur-intent
```

Inside Claude Code, use `/mcp` to inspect connected servers. After changing MCP configuration or rebuilding the local runtime, restart the Claude Code session so the stdio process is started from the new command. If startup is slow, launch Claude Code with a larger startup timeout such as `MCP_TIMEOUT=10000 claude`.

## Claude Desktop

Claude Desktop can run local stdio MCP servers through its Developer settings. It does not require a `.dxt` extension for this package.

Open Claude Desktop settings, go to Developer, choose Edit Config, and add a server to `claude_desktop_config.json`.

Common config paths:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Developer checkout:

```json
{
  "mcpServers": {
    "say-ur-intent": {
      "command": "node",
      "args": ["/absolute/path/to/say-ur-intent/dist/runtime/start.js"]
    }
  }
}
```

Published npm package:

```json
{
  "mcpServers": {
    "say-ur-intent": {
      "command": "npx",
      "args": ["-y", "@zktx.io/say-ur-intent"]
    }
  }
}
```

On native Windows, use `cmd /c` if direct `npx` or `node` resolution fails:

```json
{
  "mcpServers": {
    "say-ur-intent": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@zktx.io/say-ur-intent"]
    }
  }
}
```

Save the file and fully restart Claude Desktop. If the server does not appear, check MCP logs:

- macOS: `~/Library/Logs/Claude`
- Windows: `%APPDATA%\Claude\logs`

Claude Desktop writes general MCP connection logs to `mcp.log` and named server stderr logs to files such as `mcp-server-say-ur-intent.log`.

## Codex

Codex CLI supports stdio MCP servers and stores MCP settings in `config.toml`; by default this is `~/.codex/config.toml`, and trusted projects can use `.codex/config.toml`.

Developer checkout:

```bash
codex mcp add say-ur-intent \
  -- node /absolute/path/to/say-ur-intent/dist/runtime/start.js
```

Published npm package:

```bash
codex mcp add say-ur-intent \
  -- npx -y @zktx.io/say-ur-intent
```

Verify with:

```bash
codex mcp list
```

Inside the Codex TUI, use `/mcp` to see active MCP servers.

Equivalent `~/.codex/config.toml` entry for a developer checkout:

```toml
[mcp_servers.say-ur-intent]
command = "node"
args = ["/absolute/path/to/say-ur-intent/dist/runtime/start.js"]
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Equivalent `~/.codex/config.toml` entry after npm publication:

```toml
[mcp_servers.say-ur-intent]
command = "npx"
args = ["-y", "@zktx.io/say-ur-intent"]
startup_timeout_sec = 10
tool_timeout_sec = 60
```

After changing `config.toml`, restart the Codex session so the stdio process is relaunched from the new config.

## Cursor

Cursor supports MCP servers through `mcp.json`.

Configuration locations:

- Project-specific: `.cursor/mcp.json`
- Global: `~/.cursor/mcp.json`

Developer checkout:

```json
{
  "mcpServers": {
    "say-ur-intent": {
      "command": "node",
      "args": ["/absolute/path/to/say-ur-intent/dist/runtime/start.js"]
    }
  }
}
```

Published npm package:

```json
{
  "mcpServers": {
    "say-ur-intent": {
      "command": "npx",
      "args": ["-y", "@zktx.io/say-ur-intent"]
    }
  }
}
```

Restart Cursor after changing `mcp.json`. Cursor MCP logs are available from the Output panel; choose the MCP Logs output channel.

## First Use Flow

After the MCP server is connected:

1. Call `read.get_server_status` and record `packageName`, `version`, `evidencePolicy.version`, `network`, and `implementedToolsCount` before running evidence-policy checks. Use the returned numeric `implementedToolsCount` field instead of hand-counting the tool array.
2. Use wallet-free read tools directly when you need market context:
   - `read.list_deepbook_pools`
   - `read.list_deepbook_tokens`
   - `read.get_deepbook_mid_price`
   - `read.inspect_deepbook_orderbook`
   - `read.quote_deepbook_action`
   - `read.quote_deepbook_display_amount`
3. For wallet-account reads, call `session.create_wallet_connection`.
4. Use the internal Connect card in Claude Desktop or Codex desktop and explicitly choose the connection operation.
5. Scan the card’s pairing QR in a Sui mainnet wallet and approve the connection. This is not approval of a transaction.
6. Read or wait on the returned cardId. A card that still needs a selection does not have a pending pairing. Select an approved account explicitly if the wallet provides several.
7. Call `session.get_interaction_status` to check the connection and available default asset account. `account.get_active_account` separately reports the stored selection.
   Then call the read tool that matches the user's request:
   - `read.summarize_wallet_assets` for balances.
   - `read.classify_wallet_assets` for coin-balance roles.
   - `read.preview_intent_evidence` for natural-language USD-denominated coverage or settlement-asset balance-total evidence.
   - `read.summarize_deepbook_account_inventory` for DeepBook manager or pool-account inventory.
   - `read.summarize_sui_activity_scan` for a live bounded activity summary.
   - `read.summarize_sui_function_activity_scan` for sent transactions that called one full function target.
   If the selected tool accepts `account` and the user supplied a Sui address, pass it instead of starting wallet connection. DeepBook account inventory has no explicit address input.
8. For local review evidence, use `read.list_review_activity`, `read.summarize_review_funnel`, or `read.get_review_session_detail`.
9. For local endpoint settings or local data controls, ask your AI client to call `settings.create_local_settings_session`, then open the returned settings URL in the same machine's system browser. Setting changes apply after restart.

## Wallet Connection Boundary

An active account is read context, not login, ownership proof or transaction
permission. Explicit public-address reads do not set it. Connect and Review use
internal MCP Apps views; there is no external wallet/review page or browser
signer. A client without a card surface can use ordinary reads but cannot start
these UI workflows. See [Wallet Connection](WALLET_CONNECTION.md).

The package includes Say Ur Intent's WalletConnect project identifier. Wallet
connection requires no project ID setting and offers no project ID override.
The identifier is public, not a wallet credential. Installations share that
project's Relay service limits; service availability is not guaranteed by a
local configuration value. Only the backend owner starts its isolated SDK child, and
clients use the same product identifier when identifying that shared backend.
Do not paste pairing URIs or UI permission values into chat.

Say Ur Intent allows one usable wallet connection across the shared data folder,
with one or more wallet-approved Sui mainnet addresses. If several valid
connections are saved, the Connect card lists them for target-specific
Disconnect confirmation. Account use and signing remain blocked until the
conflict is resolved. No connection is silently chosen or remotely removed.

There is no Restart wallet service button in Connect or Settings. If the
connection service is unavailable or a disconnection remains unresponsive,
fully quit all apps using Say Ur Intent and reopen them. Closing only a window
or a client that does not own the shared backend is insufficient. Another open
client may take ownership. Verify that the old backend and SDK child exited
and that the new service becomes available; editing a config file is not a
runtime restart. A process that survives app exit needs separate diagnosis,
not a claim that recovery succeeded.

Restarting does not cancel a transaction on Sui or confirm remote disconnection.
Check retained connections in your wallet app. Saved results and the known
digests of submitted transactions remain available after restart. An
unsubmitted approval needs a fresh review and explicit wallet approval; nothing
is resent automatically. Normal initialization is not a failure warning.

The shared backend uses internal API version 6. All clients sharing a data
folder must use a compatible installation. Fully quit the old clients before
starting the same updated installation; an incompatible owner is refused.
Product schema 9 and private SDK format 1 are retained.

Review requires an explicit card action and individual wallet approval. The
backend uses Sui sign-only requests, verifies returned bytes/digest/signer and
submits once. Wallet support must be confirmed through its normal sign-only
flow; an advertised namespace or rejected request is not sufficient. Account,
Receipt and Chart do not sign or submit.

## Internal read cards

Ask the AI client to show an account asset card, a transaction result card, or a DeepBook USDC chart. The corresponding tools are `ui.open_account`, `ui.open_receipt`, and `ui.open_chart`. Claude Desktop and Codex desktop use their internal MCP Apps view. A client without that UI receives `ui_unavailable`; ordinary read tools still provide evidence.

A card accepts one read selection. Moving between chats or recreating its frame does not close valid unsubmitted input. After the server accepts the selection or its input period expires, the original input stays closed. Request a new card for a different selection. A server restart ends unfinished cards without repeating their queries; completed results remain readable. If a reply is lost, use the same card’s saved-state recovery before starting another request. These read cards do not connect a wallet, sign or submit transactions. Cards do not provide clipboard or copy-button features.

## Local data format

Start this runtime with an empty `SAY_UR_INTENT_DATA_DIR` or a database already in its current format. A mismatched existing database is refused before writes. There is no older DB or backup migration. The current database and public backup use schema 9; a development checkout replacing schema 8 needs a new empty data folder, preserving the previous folder. Older local records, known/active accounts and stored endpoints are not inherited; set the needed account context and endpoints again. Existing files are left in place, and environment overrides keep their existing precedence. See [Local DB Architecture](LOCAL_DB_ARCHITECTURE.md) for the current format, backup scope and card-result retention. Card results do not expire with the input period and can increase DB size. Reset/import removes them along with the affected local data; it is not a card-only space cleanup operation.

## Local Settings

Beginner setup uses the built-in Sui mainnet gRPC and GraphQL endpoints. You do not need to copy an endpoint into Claude, Codex, Cursor, or another MCP client.

To inspect settings or change stored endpoints, ask your AI client:

- "Show my Say Ur Intent local settings."
- "Open my Say Ur Intent local settings page."

The settings page lets the user:

- save custom Sui gRPC and GraphQL endpoints;
- restore the default Sui gRPC and GraphQL URLs;
- clear active account read context;
- reset logical local data;
- export local data;
- import replace-only local data.

Settings validation rules:

- Import preview validates the backup shape without contacting the imported endpoint.
- Import accepts only the current backup format and schema identifier. Required settings and activity fields must be present; missing fields are not filled from defaults.
- Current-format backups can contain `function_scan` provenance. Unsupported formats and scan-kind values are rejected rather than partially imported.
- Endpoint chain-identifier verification runs only when the user confirms the replace-only import.
- A custom gRPC endpoint must be an `http` or `https` URL with an explicit port and no credentials, path, query string, or fragment.
- A custom GraphQL endpoint must be an `https` URL with no credentials, query string, or fragment.
- The runtime verifies custom endpoints report the expected Sui mainnet chain identifier before saving them, including when an endpoint comes from an imported local data backup. The GraphQL endpoint is also verified lazily on first Sui activity tool use after process start.
- Endpoint changes apply after MCP server restart; restart the MCP client after setting or restoring the value.

## Advanced Runtime Settings

`SUI_GRPC_URL` and `SUI_GRAPHQL_URL` are advanced temporary overrides for operators and smoke tests. They win over the stored local setting for the current process and do not mutate SQLite:

```bash
SUI_GRPC_URL="https://fullnode.mainnet.sui.io:443" node /absolute/path/to/say-ur-intent/dist/runtime/start.js
```

```bash
SUI_GRAPHQL_URL="https://graphql.mainnet.sui.io/graphql" node /absolute/path/to/say-ur-intent/dist/runtime/start.js
```

Use this only when you need a one-run override or need to recover from a stored custom endpoint that no longer starts.

After the MCP server starts with the override:

1. Open the local settings page.
2. Restore the default endpoint or save a new endpoint.
3. Remove the environment override.
4. Restart the client.

Restoring default returns the stored endpoint to the built-in default.

If the custom provider is only temporarily unavailable, keep using the environment override or save a new custom endpoint instead.

`SAY_UR_INTENT_DATA_DIR` stays outside SQLite because the database path must be known before the database opens:

```bash
SAY_UR_INTENT_DATA_DIR="/path/to/local/app-data" node /absolute/path/to/say-ur-intent/dist/runtime/start.js
```

To reset local product data files, stop the MCP server and delete `say-ur-intent.sqlite`, `say-ur-intent.sqlite-wal`, and `say-ur-intent.sqlite-shm`, or use a new `SAY_UR_INTENT_DATA_DIR`.

Resetting, importing or replacing that database does not disconnect approvals
in your wallet app. Private SDK sessions are stored separately, and the backend
does not restore a connection without its product database record. If an old
connection is no longer listed in Say Ur Intent, remove it from the connected-app
list in your wallet app. Removing local data cannot cancel a transaction on Sui.

### Fixed review server port

`SAY_UR_INTENT_REVIEW_PORT` selects the authenticated shared backend port
(1–65535, default 8765). Clients for the same data folder must use the same port
and configuration. A second runtime owner for that folder is refused even on a
different port. No client forces a peer backend to stop. The parent can end only
its own SDK child, whose separate storage lease prevents overlapping SDK writers.
The port is not a browser-wallet authorization origin.

## Packed Package Testing

`npm run release:check` checks synchronized release metadata, typechecks, tests,
builds, and verifies the actual npm tarball and bundled licenses. It installs the
tarball in a temporary directory and runs that installed binary to check MCP
initialization, tools, document/card resources, the local Settings page and
assets, and the isolated SDK child. It confirms that Connect rejects restart
input, manage does not pair merely by opening, and the SDK keeps its exclusive
storage lease until shutdown. Runtime startup requires reachable Sui mainnet endpoints; a startup
failure leaves dependent checks unverified. The check uses an isolated data
directory and port, ends the child process before cleanup, and does not use your
stored wallet sessions, pair a wallet, sign, submit, reset data, or publish to npm.
See [Utility Index](UTILITY_INDEX.md#release-package-check) for prerequisites.

## Current Release Limitations

- Product-facing behavior is mainnet-only.
- Current asset reads without an explicit address require the selected account to have a usable current wallet connection. An explicit address works only for tools that accept `account`; DeepBook account inventory instead needs a usable connection and account selection. Saved result reads remain available.
- Account-bound DeepBook review requires all evidence stages. The internal
  Review card then allows an explicit WalletConnect request under user control.
  Requests and observed chain results are separate; missing results remain
  unknown and are not resubmitted automatically.
- External proposals remain non-signable. `blocked` refers to that review's
  unmet evidence requirements, not to a hidden fallback signing path.
- The `npx` and global-install client configs require a published version of
  `@zktx.io/say-ur-intent`. A developer checkout or packed tarball tests local
  changes; its existence does not establish public package availability.

## Mainnet Read Smoke

Run this manually before release checks when a mainnet gRPC provider is available. Normal setup does not require setting `SUI_GRPC_URL`; this environment variable is an operator override for the smoke process.

```bash
export SUI_GRPC_URL="https://fullnode.mainnet.sui.io:443"
export SUI_GRAPHQL_URL="https://graphql.mainnet.sui.io/graphql" # optional override; default is the built-in mainnet GraphQL endpoint
export SMOKE_SUI_ADDRESS="0x..."
export SMOKE_DEEPBOOK_POOL_KEY="DEEP_SUI"
export SMOKE_QUOTE_AMOUNT="1000000000" # raw integer units; for SUI, 1000000000 = 1 SUI
# Optional: export SMOKE_INSPECT_DIGEST="..."
# Optional: export SMOKE_INSPECT_RANDOM_LATEST="true"
# Optional: export SMOKE_FUNCTION_TARGET="0x...::module::function"
npm run build
npm run smoke:mainnet
```

The smoke script calls read-only MCP tools against mainnet:

- wallet assets;
- DeepBook orderbook;
- raw-quantity DeepBook quote;
- `read.scan_sui_account_activity` for `SMOKE_SUI_ADDRESS` with limit 5;
- `read.summarize_sui_activity_scan` through active account context with limit 5.

When `SMOKE_FUNCTION_TARGET` is set to a full `package::module::function`, it also calls:

- `read.scan_sui_function_activity` for `SMOKE_SUI_ADDRESS` with limit 5;
- `read.summarize_sui_function_activity_scan` through active account context with limit 5.

The raw-quantity DeepBook quote smoke path does not call the display-amount quote.
It also does not exercise account-bound DeepBook transaction-material build or
internal digest binding. A funded-account material-build smoke is a separate
operator check before smoke results can be treated as product-grade proof for
that review stage.

Empty account or function activity pages are valid smoke outcomes. They are recorded with `rowCount: 0` and `emptyAccepted: true`.

When `SMOKE_FUNCTION_TARGET` is unset, function activity smoke is recorded as not run with `notRunReason: "missing_env"`.

The smoke result file records tool names, environment-variable presence, activity status, row counts, source method, window/order flags, persistence status, whether a function target was present, and evidence-boundary metrics.

Recorded metrics include:

- `fullDetailsReturned`;
- `compactReturned`;
- `compactBalanceChangeRowCount`;
- `compactAggregatedBalanceChangeRowCount`;
- `transactionContextCount`;
- `requestedAccountTransactionFactCount`;
- `requestedAccountTransactionFactBalanceChangeRowCount`;
- `requestedAccountEffectBalanceChangeRowCount`;
- `requestedAccountEffectTruncatedTransactionCount`;
- `requestedAccountCoinFlowCount`;
- `analysisCoinFlowCount`.

The result file does not store raw GraphQL payloads, transaction bytes, signatures, raw transaction details, or compact transaction aggregates.

Activity scan and summary smoke paths fail if full transaction details or compact transaction aggregates are returned.

It does not call DeepBook account inventory tools.

If `SMOKE_INSPECT_DIGEST` is set, it also calls `read.inspect_sui_transaction` for that digest and the smoke address.

If `SMOKE_INSPECT_RANDOM_LATEST=true` is set and `SMOKE_INSPECT_DIGEST` is unset, it samples one digest from the latest GraphQL transaction page and inspects that digest without an account argument.

It is not part of CI or `release:check`.
`SMOKE_SUI_ADDRESS` must be a 32-byte hex Sui address, for example `0x` followed by 64 hex characters.
`SMOKE_FUNCTION_TARGET` is optional. When set, it must be a full Sui function target in `package::module::function` form; package-only, package-and-module-only, bare function names, and generic/type-argument forms fail the optional function activity smoke path.
`SMOKE_INSPECT_DIGEST` is optional. Use a digest whose sender or returned balance-change owner is `SMOKE_SUI_ADDRESS` to exercise the stored digest-lookup path; otherwise the lookup can still return `ok` with `persistence.stored: false`.
`SMOKE_INSPECT_RANDOM_LATEST=true` checks current transaction-read shape without pinning a specific user address and without exercising the stored relation path.

## Troubleshooting

### Server does not appear in the client

- Confirm the command uses absolute paths for local checkout setup.
- Confirm `npm run build` has completed after source changes.
- Restart the MCP client so it relaunches the stdio process.
- Run the configured command directly in a terminal and check stderr.
- For Claude Desktop, check the MCP logs under `~/Library/Logs/Claude` or `%APPDATA%\Claude\logs`.

### Runtime exits on startup

A bootstrap failure exits with code 1 and a `fatal runtime error` diagnostic on
stderr, including a safe stage and reason. An MCP initialization response alone
does not mean backend startup succeeded. A foreign or incompatible port owner,
private data ownership/permission failure, and mainnet endpoint failure are
reported separately. Use the same installed runtime and configuration in all
clients; the runtime does not replace an incompatible listener automatically.
Normal client input closure exits with code 0 after cleanup. SIGINT/SIGTERM keep
codes 130/143. Cleanup failure is reported and makes a normal closure fail; it
cannot erase an earlier fatal or signal exit. SDK service unavailability is a
separate condition and does not by itself shut down the parent read service.

- Do not set `SUI_RPC_URL`; this runtime intentionally uses Sui gRPC and rejects Sui JSON-RPC config.
- If a stored custom endpoint fails, temporarily start with `SUI_GRPC_URL`, open the local settings page, restore the default Sui gRPC URL or save a new endpoint, remove the override, and restart.
- If an environment override is present, confirm it has scheme, host, and explicit port only.
- If the startup chain identifier guard fails, use a Sui mainnet gRPC endpoint. If a Sui activity tool fails its GraphQL chain identifier guard, use a Sui mainnet GraphQL endpoint.

### Tool calls return `active_account_not_set`

For tools with an `account` input, provide an explicit Sui address in chat. DeepBook account inventory has no address input and needs a connected selected account. When connection or account selection is wanted:

1. Open a Connect card with `session.create_wallet_connection` and `intent: connect`.
2. The card prepares the QR after confirming current state.
3. Scan it and approve the Sui mainnet connection in your wallet.
4. Read or wait on that cardId; select an approved read account when required.
5. Confirm connection availability with `session.get_interaction_status`. Stored read context alone is not a usable default for current asset reads.

If the user supplied a specific Sui address for `read.summarize_wallet_assets` or `read.classify_wallet_assets`, pass that address as `account` instead of creating a wallet connection session.

### NPM command returns 404

A 404 means the requested package or version could not be retrieved from the
selected registry. Confirm the exact name and version, for example with
`npm view @zktx.io/say-ur-intent@0.4.4 version --registry=https://registry.npmjs.org`.
A new version may not have been published or become visible yet; a mistyped name
or an alternate/private registry can also explain the response. Check the
publication result and registry configuration before retrying. Do not assume
that the package exists solely because a local checkout builds successfully.
Developer Checkout Setup or `npm run release:check` can test local changes;
neither substitutes for public publication.

## Client Snippets

The Claude Code, Claude Desktop, Codex, and Cursor snippets above were checked against official client documentation current to this repository update. If a client changes its MCP config format, prefer that client's official documentation over this file and update this file in the same change.

### Optional account-bound review smoke

Set `SMOKE_SWAP_PROTOCOL`, `SMOKE_SWAP_FROM_SYMBOL`, `SMOKE_SWAP_TO_SYMBOL` and
`SMOKE_SWAP_AMOUNT_DISPLAY` together to opt into read-only account-bound review
computation. Protocol is explicitly `deep`; the smoke does not silently select a protocol.
A partially configured group is an error. `SMOKE_SWAP_MAX_SLIPPAGE_BPS` keeps the
existing explicit override. The script uses the same runtime review composition,
material store and evidence validation as the product, and records whether
transaction review data was emitted. This can involve mainnet simulation but
never wallet pairing, signing or submission. The temporary active-account
fixture is not proof of a wallet connection or ownership. Without the complete
optional group, the result records that review computation was not run.
