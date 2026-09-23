# MCP Setup

This is the setup guide for Say Ur Intent MCP clients. It owns installation, MCP client connection, first-use flow, local settings, and troubleshooting.

It does not define tool field contracts or response wording. Use `docs/MCP_TOOLS.md` for the MCP API reference and `docs/AGENT_BEHAVIOR.md` for the answer playbook.

The README keeps only the short entry path; client-specific setup, restart behavior, and troubleshooting live here.

Say Ur Intent is tested from a local checkout in this repository state.

## Key terms

- Sui: the mainnet blockchain whose DeFi state this project reads.
- MCP: Model Context Protocol, the tool-calling interface used by AI clients.
- DeepBook: Sui's onchain order book protocol.
- SDK: Software Development Kit, a version-pinned library dependency used by this repository.
- gRPC and GraphQL: Sui SDK transports used by this runtime for mainnet reads.
- dApp Kit: Sui's wallet connection library for web apps.
- stdio: standard input/output, the local transport used by MCP clients to talk to this server.
- Stelis: the GitHub and npm namespace for this package. Say Ur Intent is the product and runtime name.

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

Wallet-account reads require a wallet identity session created through `session.create_wallet_identity`.

## Developer Checkout Setup

Use this path when you download the repository from GitHub and want to test the local build:

```bash
git clone https://github.com/stelis-dev/say-ur-intent.git
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
[MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=say-ur-intent),
find the `io.github.stelis-dev/say-ur-intent` entry and install it through your
client. The resulting stdio server command is equivalent to:

```sh
npx -y @stelis/say-ur-intent
```

Clients that do not install from the registry use the published-package and
per-client configuration below, which give the exact `command` and `args`.

## Published Package Setup

`@stelis/say-ur-intent` is on npm; there are two ways to run it. Both start
the same `say-ur-intent` stdio MCP server; pick based on whether you want
automatic updates or the fastest, most reliable startup.

### Download on demand (npx, tracks the latest release)

```json
{
  "command": "npx",
  "args": ["-y", "@stelis/say-ur-intent"]
}
```

No install step, and each launch resolves the latest published version. The
trade-off: the first launch (or the first after the npx cache is cleared)
downloads the package and its native dependencies. On a cold cache this can take
long enough to exceed a client's MCP startup timeout, so the client may stop the
server before it connects. If that happens, warm the cache once in a terminal and
then restart the client:

```bash
npx -y @stelis/say-ur-intent
# wait until it logs "review server started", then stop it with Ctrl-C
```

### Install once (global, fastest startup, pinned version)

```bash
npm install -g @stelis/say-ur-intent
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
npm install -g @stelis/say-ur-intent@latest
```

The per-client sections below use the `npx` form. To use a global install
instead, replace the published-package command with `"command": "say-ur-intent"`
and drop the `args`. On native Windows clients that need `cmd`, wrap either
command, for example `"command": "cmd", "args": ["/c", "npx", "-y", "@stelis/say-ur-intent"]`.

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
  -- npx -y @stelis/say-ur-intent
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
      "args": ["-y", "@stelis/say-ur-intent"]
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
      "args": ["/c", "npx", "-y", "@stelis/say-ur-intent"]
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
  -- npx -y @stelis/say-ur-intent
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
args = ["-y", "@stelis/say-ur-intent"]
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
      "args": ["-y", "@stelis/say-ur-intent"]
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
3. For wallet-account reads, call `session.create_wallet_identity`.
4. Open the returned `walletUrl` in the same machine's system browser. Do not move the URL to another device; it contains a short-lived fragment token.
5. Connect a Sui mainnet wallet. The page captures only the selected account address and chain identifier.
6. Immediately call `session.wait_wallet_identity` after giving the URL, or poll `session.get_wallet_identity` about every 5 seconds until the status is `connected`. Do not wait for the user to return and say they connected before checking the session.
7. Call `account.get_active_account` to confirm the current active account context.
   Then call the active-account tool that matches the user's request:
   - `read.summarize_wallet_assets` for balances.
   - `read.classify_wallet_assets` for coin-balance roles.
   - `read.preview_intent_evidence` for natural-language USD-denominated coverage or settlement-asset balance-total evidence.
   - `read.summarize_deepbook_account_inventory` for DeepBook manager or pool-account inventory.
   - `read.summarize_sui_activity_scan` for a live bounded activity summary.
   - `read.summarize_sui_function_activity_scan` for sent transactions that called one full function target.
   If the user provided a specific Sui address for these reads, pass that address as `account` instead of starting wallet identity.
8. For local review evidence, use `read.list_review_activity`, `read.summarize_review_funnel`, or `read.get_review_session_detail`.
9. For local endpoint settings or local data controls, ask your AI client to call `settings.create_local_settings_session`, then open the returned settings URL in the same machine's system browser. Setting changes apply after restart.

## Wallet Identity Boundary

Wallet-free DeepBook read boundaries are summarized in [Default Setup](#default-setup).

Active-account reads use the active account context created by the first-use wallet identity flow above.

Explicit-address coin balance reads through `read.summarize_wallet_assets` and `read.classify_wallet_assets` are public-address snapshots. They do not create active account context.

The wallet identity page captures only the selected account address and chain identifier. It does not prepare a transaction or request wallet authorization. MCP client sidebars and embedded webviews are not supported wallet identity surfaces; use the same machine's system browser.

## Internal read cards

Ask the AI client to show an account asset card, a transaction result card, or a DeepBook USDC chart. The corresponding tools are `ui.open_account`, `ui.open_receipt`, and `ui.open_chart`. Claude Desktop and Codex desktop use their internal MCP Apps view. A client without that UI receives `ui_unavailable`; ordinary read tools still provide evidence.

A card accepts one read selection. Moving between chats or recreating its frame does not close valid unsubmitted input. After the server accepts the selection or its input period expires, the original input stays closed. Request a new card for a different selection. A server restart ends unfinished cards without repeating their queries; completed results remain readable. If a reply is lost, use the same card’s saved-state recovery before starting another request. These read cards do not connect a wallet, sign or submit transactions. Cards do not provide clipboard or copy-button features.

## Local data format

Start this runtime with an empty `SAY_UR_INTENT_DATA_DIR` or a database already in its current format. A mismatched existing database is refused before writes. There is no older DB or backup migration. Older local records, known/active accounts and stored endpoints are not inherited; set the needed account context and endpoints again. Existing files are left in place, and environment overrides keep their existing precedence. See [Local DB Architecture](LOCAL_DB_ARCHITECTURE.md) for the current format, backup scope and card-result retention. Card results do not expire with the input period and can increase DB size. Reset/import removes them along with the affected local data; it is not a card-only space cleanup operation.

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

### Fixed review server port

`SAY_UR_INTENT_REVIEW_PORT` pins the local review server to a fixed loopback
port (1-65535; default `8765`). A fixed port keeps the review
page origin stable across server restarts, so the browser wallet's
authorization and the signing auto-reconnect persist instead of being asked
again on every restart. If the port is taken, the server fails to start
rather than silently moving.

## Packed Package Testing

`npm run release:check` builds, tests, creates an npm tarball, verifies package contents, and installs the packed tarball in a temporary directory. It does not publish to npm.

## Current Release Limitations

- Product-facing behavior is mainnet-only.
- Wallet-account reads require an active account read context from wallet identity.
- The signable review path is implemented for the account-bound DeepBook and
  FlowX swap reviews:
  review evidence runs through review-time simulation, a schema-validated
  wallet review contract is emitted on a `ready_for_wallet_review` state, and
  the local review page offers a digest-gated byte handoff with
  user-controlled wallet signing. After the page reports the signed transaction
  digest, the review server re-reads Sui mainnet and records normalized chain
  receipt evidence. MCP responses still do not contain transaction bytes or
  signing data, and they do not provide signing readiness.
- Here, `blocked` means required review evidence or user action is missing for
  that session (for example `wallet_review_contract_emit_missing`), not a
  release-wide signing stop.
- The package is published to npm as `@stelis/say-ur-intent`, so the `npx` and
  global-install client configs in this guide work directly. A developer
  checkout (local build) or packed tarball is an option for testing local
  changes.

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

- Do not set `SUI_RPC_URL`; this runtime intentionally uses Sui gRPC and rejects Sui JSON-RPC config.
- If a stored custom endpoint fails, temporarily start with `SUI_GRPC_URL`, open the local settings page, restore the default Sui gRPC URL or save a new endpoint, remove the override, and restart.
- If an environment override is present, confirm it has scheme, host, and explicit port only.
- If the startup chain identifier guard fails, use a Sui mainnet gRPC endpoint. If a Sui activity tool fails its GraphQL chain identifier guard, use a Sui mainnet GraphQL endpoint.

### Tool calls return `active_account_not_set`

For active-account reads:

1. Create a wallet identity session with `session.create_wallet_identity`.
2. Open the `walletUrl` in the same machine's system browser.
3. Connect a Sui mainnet wallet.
4. Immediately call `session.wait_wallet_identity` after giving the URL, or poll `session.get_wallet_identity` until `connected`.
5. Confirm the current context with `account.get_active_account`.

If the user supplied a specific Sui address for `read.summarize_wallet_assets` or `read.classify_wallet_assets`, pass that address as `account` instead of creating a wallet identity session.

### NPM command returns 404

`@stelis/say-ur-intent` is published to npm, so a 404 is not a "package does not
exist" state. Treat it as a transient registry/network reachability issue, a
mistyped package name, or a request for a version that does not exist: confirm
the spelling, check `npm view @stelis/say-ur-intent version`, retry after any
registry/proxy outage clears, and ensure no private/alternate npm registry is
configured. Developer Checkout Setup or `npm run release:check` remains an
option for testing local changes, not a substitute for an unpublished package.

## Client Snippets

The Claude Code, Claude Desktop, Codex, and Cursor snippets above were checked against official client documentation current to this repository update. If a client changes its MCP config format, prefer that client's official documentation over this file and update this file in the same change.
