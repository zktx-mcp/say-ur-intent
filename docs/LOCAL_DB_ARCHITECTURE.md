# Local DB Architecture

Say Ur Intent uses a local SQLite database for durable product state that must survive MCP server restarts. The database stores account read context, Say Ur Intent review activity evidence, live review and session state shared across local AI clients, and user-requested bounded Sui activity facts. It is not a custody store, wallet authorization store, background indexer, complete wallet-history store, or raw transaction archive.

This document is for maintainers and contributors who change local state, import/export behavior, activity queries, or review evidence storage. Product users normally need only the README and `docs/MCP_SETUP.md`.

## Runtime Boundary

The process that binds the configured loopback port initializes these local components. Other stdio processes authenticate that server and forward their calls; they do not open SQLite:

- a local SQLite store;
- a mainnet guard for the configured Sui gRPC endpoint;
- the local review HTTP server on `127.0.0.1`;
- authenticated internal MCP sessions, reached by each client through a stdio forwarder.

The GraphQL endpoint is also mainnet-guarded when it is saved through settings, imported from a local-data backup, or first used by Sui activity tools.

Stdout is reserved for MCP JSON-RPC messages. Logs go to stderr.

## Local Data

The runtime creates a local SQLite file for account read context and Say Ur Intent review activity evidence. Users do not install a database server separately.

Override the app data directory only when needed:

```bash
export SAY_UR_INTENT_DATA_DIR="/path/to/local/app-data"
```

The stored active account is for reading wallet state only. It does not let the toolkit sign transactions on your behalf.

User-requested bounded transaction scans can store normalized facts only when a transaction is related to a known local wallet. This product does not run a background or complete wallet history indexer.

The default Sui mainnet gRPC and GraphQL endpoints are stored in the local SQLite settings table on first run.

To inspect settings or change local data, ask your AI client to create a Say Ur Intent local settings session and open the returned settings URL in the same machine's system browser.

Endpoint changes apply after the MCP server restarts.

## Engine

The runtime uses the `better-sqlite3` npm package for normal SQLite file semantics and incremental writes. Users do not install a separate database server.

The package targets Node.js `>=22`. Node 22 or 24 LTS is recommended.

`better-sqlite3` is an npm dependency, not a separate product database installation. The pinned version is `12.9.0`. Standard macOS arm64/x64, Linux arm64/x64, and Windows x64 platforms normally use prebuilt binaries; less common platforms such as Windows arm64 can require a native build toolchain. The release check verifies that the driver can be imported, can create an in-memory database, and also works after installing the packed tarball.

## File Location

On first start, the runtime creates a SQLite file named `say-ur-intent.sqlite` under the operating system's app data directory for Say Ur Intent.

The optional override is:

```bash
export SAY_UR_INTENT_DATA_DIR="/path/to/local/app-data"
```

Product docs, MCP responses, and tool outputs must not reveal a user's absolute database path. Use placeholders in documentation.

## Open Policy

Every database connection applies:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
```

Writes use SQLite's normal file-backed engine. An empty file is initialized to the current schema. An existing file is checked read-only before opening for writes: its format identifier and schema metadata must match the current definitions. The runtime does not migrate, repair or silently reset another format.

Use an empty `SAY_UR_INTENT_DATA_DIR` for a new installation. Existing files remain untouched. Product reset is a separate confirmed Settings action.

WAL mode can create companion files next to the main database, such as `say-ur-intent.sqlite-wal` and `say-ur-intent.sqlite-shm`. Backups and manual moves should keep those files together with the main database while the MCP server is stopped. Avoid placing `SAY_UR_INTENT_DATA_DIR` in cloud-synchronized folders such as iCloud Drive, Dropbox, or similar sync roots because WAL companion files can be copied out of order.

## Tables

- `accounts`: normalized Sui account addresses and first/last use timestamps.
- `active_account_context`: a single-row read context. It can point to one active account or be cleared.
- `review_sessions`: review session header, current status, full action plan JSON, and materialized requested intent JSON when present.
- `review_state_snapshots`: append-only account-bound `ReviewState` snapshots with status and reason columns for queryability.
- `review_status_transitions`: append-only review lifecycle timing for funnel and review-timing analysis.
- `review_executions`: Say Ur Intent review execution result evidence, keyed by
  `review_session_id`. For signed review-page swaps, the execution result JSON
  can include normalized server-read Sui chain receipt evidence for the signed
  transaction digest.
- `external_activity_scans`: user-requested digest lookups, bounded account scans, or sent-function scans, including request window, endpoint host, chain identifier, continuation metadata, coverage signals, and internal scan-kind provenance.
- `external_activity_transactions`: normalized Sui transaction facts linked to a known local account and the first/last scan that observed them. The optional detail JSON stores typed facts such as capped Move call targets, raw balance changes, object changes, event summaries, gas raw cost fields, execution errors, and truncation flags when GraphQL returns them. Each stored detail JSON value is capped at 64 KiB.
- `local_settings`: allowlisted local settings. The current key set is `suiGrpcUrl` and `suiGraphqlUrl`, stored as JSON-encoded text and applied after restart.
- `coin_metadata_cache`: account-independent positive cache for Sui coin metadata used only to format wallet balance display amounts. Rows are keyed by normalized coin type and verified mainnet chain identifier, expire after 24 hours, and are excluded from local data export/import. Read or write failures for this cache block affected wallet unit reads with `metadata_cache_unavailable`; they are not reported as unavailable token decimals.

The following live session tables hold runtime session state in the shared database so any one review server can serve a session another client created (see [Shared single-origin review server](#shared-single-origin-review-server)):

- `live_review_sessions`: the live review session record — status, bound
  account, the pending wallet-handoff lock, the plan / review-state /
  execution-result JSON, timestamps, revision, and write-contract marker —
  keyed by session id.
- `live_private_review_artifacts`: per-session private review evidence (the transaction-material handle, its digest commitment, and derived evidence), cascade-deleted with its review session.
- `live_transaction_materials`: locally built unsigned transaction bytes stored as a BLOB behind a redacted handle, with a TTL; deleted on signing, terminal result, or expiry.
- `live_wallet_identity_sessions` and `live_settings_sessions`: the short-lived wallet-identity and settings capture sessions, stored as validated JSON keyed by session id.

These live tables are distinct from the append-only review evidence tables above: the evidence tables remain the durable activity/audit record, while the live tables hold the in-flight session state that the review server serves.

Database columns use snake_case. MCP and HTTP JSON fields use camelCase, so the database `review_session_id` column stores the same review-session identity exposed as `reviewSessionId` in API responses.

Table relationships:

- `active_account_context.account_id` and `review_sessions.account_id` point to `accounts.id` when an account is present.
- `review_state_snapshots`, `review_status_transitions`, and `review_executions` point to `review_sessions.id` through `review_session_id` and can also point to `accounts.id` through `account_id`.
- `external_activity_scans.account_id` points to `accounts.id`. It records which known local account the user-requested lookup or scan was scoped to.
- `external_activity_transactions.account_id` points to `accounts.id`, and `first_scan_id` / `last_scan_id` point to `external_activity_scans.scan_id`. `known_sender_account_id` points to `accounts.id` only when the sender is also a known local account. Non-known party account addresses are not stored; normalized detail JSON keeps account-owner and event-sender fields only when they match the known local account.
- `coin_metadata_cache` is account-independent and is keyed by coin type plus chain identifier.
- `local_settings` is independent local configuration and does not point to account or review rows.

The database does not create background transaction indexing tables. Complete external transaction history, raw GraphQL payloads, transaction bytes, signatures, BCS payloads, non-known party account addresses, and arbitrary transaction payloads are not product surfaces of this database. Server-read chain receipt evidence is normalized execution-result JSON for a reviewed signed transaction digest; it is not raw BCS, transaction bytes, wallet signatures, or a complete transaction-history index.

`external_activity_scans.kind` records the lookup category as `account_scan`,
`digest_lookup`, or `function_scan`. Stored scan rows keep their recorded kind;
the database does not infer missing function targets from `account_scan` rows.

The `live_review_sessions` table stores a monotonically increasing `revision`
and `write_contract_version: "shared_sqlite_review_session_v1"`. Insert and
update triggers reject revision-unaware writers: inserts must use
`revision = 0` and the current write-contract marker, and updates must increase
the revision by exactly one and keep the current write-contract marker.

Logical local data reset is the local settings page action that clears stored product state through the runtime without requiring manual database-file deletion. Replace-only import is the settings page import path that replaces local product state from a validated backup. Both logical local data reset and replace-only import clear `coin_metadata_cache`, card records, live review/wallet/settings sessions, private review artifacts and transaction material in the same SQLite transaction. A rollback preserves the existing data and permissions. No separate HTTP cleanup call owns permission invalidation. Clearing active account context does not clear it because coin metadata is account-independent.

Non-terminal review session expiry is recorded lazily when the session is read or mutated after its TTL. There is no background expiry worker.

## Shared local server

Exactly one stdio process binds the configured loopback port and creates the shared services and SQLite stores. Other clients authenticate the listener before sending control credentials and forward MCP messages to it. The authentication covers database identity, runtime API version, configuration and server instance. Proof and subsequent dispatch use the same TCP connection. Host/Origin validation is separate from authentication; neither protects against a malicious process running as the same OS user.

The private `runtime-control.key` file is separate from UI permissions and wallet credentials and is excluded from product backups. Stdio closure and process signals close the owned server; no client signals another process. A peer can acquire the port after it becomes free. Failed calls are not replayed automatically.

All state-writing MCP callers use this owner, including reads that save activity, metadata or chain results. An asynchronous operation carries the current data generation. Access after replacement or shutdown is refused, preventing a late response from writing into replacement data. Live review transitions retain revision/CAS and SQLite transactions. No network wait is held inside a database transaction.

### Read cards

`live_read_cards` owns the read card kind, permission hash, backend owner, revision, original/accepted input, state/reason and saved result. Admission and result writes use conditional updates. Expiry is applied by the backend to unsubmitted input; a View timer only requests state. Frame recreation and chat navigation perform no close transition. The backend rejects late writes after local data replacement or owner changes, and recovery closes unfinished cards without repeating their source query.

The same record contains a model-safe result and, for receipts, separately validated UI-only input values and PTB display data. They are projections of one source read. They are not activity evidence or serialized signing material. Public saved resources exclude the private partition, and product backups exclude card records and permission hashes entirely.

Input TTL is not a result-retention deadline. Completed results survive restart and remain until explicit local data reset/import; there is no automatic age-based deletion or per-card size cap. Existing query limits still apply. DB size can therefore grow with usage. Reset/import affects other local data too and must retain its explicit confirmation and failure-atomicity contract.

### Unsigned transaction material on disk

`live_transaction_materials` stores locally built unsigned transaction bytes so a review can be signed by whichever process owns the port. The data directory is created `0700` and the database file is set `0600` so other operating-system users cannot read them; the bytes carry a short TTL and are deleted on signing, terminal result, or expiry. This store is separate from the review evidence path: the MCP tool layer still does not return transaction bytes, and the activity-store evidence inputs still reject transaction bytes, signatures, and signing material before write.

### Current format and backups

The current `user_version` is 8. It identifies one supported schema; there is no migration registry or older-format decoder. All clients sharing a data directory must use the same compatible runtime.

A current backup carries `format`, `schemaVersion`, `network`, `exportedAt` and its product data. Import rejects a missing or different schema identifier, incomplete required fields, invalid references or invalid raw quantities. Missing settings or activity arrays are not filled from defaults. Supported `function_scan` provenance remains part of the current format. Validation failure leaves current data intact.

New installations do not inherit older local review records, activity scans, known/active accounts or stored endpoints. Users configure the required context again; environment overrides retain their existing precedence. Empty local history does not imply an absence of on-chain transactions. Existing DB and backup files are not deleted by startup.

## Boundaries

The active account is a read context only. It is not signing authorization, login, authentication for transactions, custody, permission for transactions, or proof of ownership. It stores at most one address per database file; setting a new active account replaces the previous one without revoking anything onchain.

NDJSON event logs remain optional audit/debug logs. They are not the product activity source of truth. User-facing activity summaries read from SQLite. Event log write failures do not fail product session transitions or SQLite evidence writes.

Raw session tokens are not stored in SQLite. Live session records store token hashes for validation; this private state is separate from activity evidence and product backups. The activity-store evidence input types do not accept session token material, and review evidence JSON is checked with the same forbidden-field-name policy used for MCP output. Transaction bytes, signatures, serialized signing material, token-hash/session-token-like fields, seeds, mnemonics, and private-key-like field names are rejected before write. External proposal ingestion also rejects recognized Sui private-key strings, valid English BIP39 mnemonic phrases, obvious sensitive markers, and suspicious raw secret-like payloads before storing the sanitized requested intent. Generic asset metadata such as token symbols remains allowed.

The local settings table is not a secret store. It stores only allowlisted local preferences such as the Sui mainnet gRPC and GraphQL endpoints. It must not store database paths, tokens, credentials, private keys, mnemonics, seeds, or arbitrary API keys. Environment overrides such as `SUI_GRPC_URL` and `SUI_GRAPHQL_URL` can temporarily supersede stored endpoints without mutating the database.

Review intent capture follows one adapter convention: if an adapter wants the original requested intent materialized for activity queries, it must place that object at `ActionPlan.adapterData.requestedIntent`. The full `plan_json` remains the canonical action plan, and `intent_json` is only the query-friendly copy of that adapter-supplied intent.
