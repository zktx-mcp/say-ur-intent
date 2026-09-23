# Wallet Identity

This document is the wallet identity capture specification for Say Ur Intent. It is product-facing design guidance and must not be treated as transaction authorization.

This document owns the wallet identity boundary: what active-account read context is, how same-machine capture works, which state transitions exist, and what wallet identity is not.

It does not own general setup steps, MCP tool contracts, or user-question playbooks. Product users should follow the README and `docs/MCP_SETUP.md`. MCP response fields are documented in `docs/MCP_TOOLS.md`.

This document is for agents, frontend contributors, backend contributors, and reviewers who implement or verify wallet identity capture.

Frontend display and action policy is defined in `docs/FRONTEND_POLICY.md`.

## Purpose

Wallet identity capture provides one account source for wallet-account reads and account-bound review.

MCP clients create and poll a local capture session.

The local review server serves the wallet page and validates Host, Origin, and the fragment token.

The browser frontend connects a Sui wallet and sends only the selected account address and mainnet chain identifier back to the local server.

The session store owns all state transitions.

Wallet identity capture is not transaction review, wallet creation, login, signing authorization, custody, or persistent permission.

It does not request authorization, does not construct executable transaction material, and does not imply that an action is safe.

A capture session ends when the user closes the wallet page or it expires.

The captured address remains as a read context until the user clears it.

The `walletUrl` field is the wallet URL returned by the MCP tool.

It must be opened in the same machine's system browser because the review server is bound to loopback.

MCP client sidebars and embedded webviews are not supported wallet identity surfaces.

The URL includes a short-lived fragment token; do not copy, sync, share, or move it to another device.

## Active Account Persistence

The active account is persisted in the local SQLite store and survives server
restarts. It remains the read-context account until the user clears it through
`account.clear_active_account` or the settings page. A connected identity
result also records which wallet held the account (wallet name and wallet
standard id). Wallet connection happens only on the connection page; the
review page reads the recorded account from the server as its single source of
truth, shows it in the header, and never connects a wallet itself. For the
signing step it relies on dapp-kit autoconnect restoring the signer on the
same fixed-port origin where the wallet was connected. That review origin is a
single per-machine port (default 8765, overridable per registration with
SAY_UR_INTENT_REVIEW_PORT): when a second Say Ur Intent instance finds the port
already held by a healthy Say Ur Intent review peer, it does not stop that peer
and does not start a port war; it defers to the peer on the shared origin and
takes the origin over only when that owner exits. A port held by any other
(non-Say-Ur-Intent) process is never taken over. The record is
read context and wallet preference only; it is not signing authorization.

## Status Model

Product statuses are:

```ts
pending | opened | connecting | connected | rejected | failed | expired
```

`pending`, `opened`, and `connecting` are non-terminal.

`connected`, `rejected`, `failed`, and `expired` are terminal.

Terminal sessions are immutable. Replacing or clearing the active account context does not rewrite earlier wallet identity sessions.

The pinned `@mysten/dapp-kit-core` frontend connection store has `disconnected`, `connecting`, `reconnecting`, and `connected`.

Those raw statuses are frontend internals and must be mapped into the product status model.

`reconnecting` occurs when dapp-kit autoconnect restores the selected wallet on the same fixed-port origin; the frontend maps it to the `connecting` product status while the signer settles. dapp-kit storage holds the wallet autoconnect preference only, never keys.

## Failure Reasons

Wallet identity failure reasons are:

```ts
user_rejected
no_compatible_wallet
no_accounts_authorized
unsupported_chain
wallet_provider_error
```

`user_rejected` is used only when the wallet error is positively identified as a Wallet Standard user rejection.

`no_compatible_wallet`, `no_accounts_authorized`, and `unsupported_chain` are used only when deterministically observed.

All other wallet provider failures use `wallet_provider_error` with an optional sanitized `failureDetail`.

## State Contracts

`connected` requires `account` and `chain: "sui:mainnet"`. `rejected` requires `failureReason: "user_rejected"`. `failed` requires a non-user failure reason. `pending`, `opened`, and `connecting` must not include an account. `expired` is terminal and does not contain an account.

Active-account reads require active account context when no explicit public account is supplied.

`read.preview_intent_evidence` can use either an explicit public Sui address supplied as `account` or the active account when `account` is omitted.

`read.summarize_deepbook_account_inventory` uses active account context.

`read.summarize_wallet_assets` and `read.classify_wallet_assets` can read either an explicit public Sui address supplied as `account` or the active account when `account` is omitted.

Explicit-address coin balance and intent-evidence reads do not prove ownership, store the address as a known wallet, or create active account context.

Sender-independent DeepBook orderbook, raw-quantity quote, display-amount quote, and settlement-asset-group reads stay wallet-free.

The pinned SDK requires a transaction simulation sender for some market reads, but Say Ur Intent supplies an internal mainnet placeholder when the result does not depend on a user's wallet.

After a wallet identity connection succeeds, Say Ur Intent stores that normalized account as the active read context in the local SQLite database.

This is unconditional. There is no opt-out short of clearing it through `account.clear_active_account`.

The active account can be reused for wallet-account reads until the user clears or replaces it.

This is not login, signing authorization, custody, or permission for transactions.

Use `account.get_active_account` when the current active account context matters. A historical wallet identity session can remain `connected` even after the active account is cleared or replaced by another session.

Account-bound review sessions must bind to the active wallet identity account before review state is accepted.

A review account that does not match the active account context is rejected.

Once the signable adapter's review evidence completes, the account-bound review reaches `ready_for_wallet_review` and the local review page offers a digest-gated handoff and user-controlled wallet signing.

The active account context stays read context and wallet preference only; it is not signing authorization, and the MCP layer does not sign, execute, or return transaction bytes on its own.

## Frontend Boundary

The wallet frontend uses pinned dapp-kit core APIs and renders a minimal wallet list in the local review app.

The pinned `@mysten/dapp-kit-core/web` package version is recorded in `docs/SDK_API.md` and pinned in `package.json`.

Its button and modal do not expose wallet provider errors as public events. The frontend calls `connectWallet()` directly to classify deterministic wallet outcomes without inspecting private DOM state or overfitting error strings.

The wallet page must say address capture only. It must not show transaction review language, authorization buttons, private-key handling, executable transaction material, or safety guarantees.

## HTTP Boundary

The wallet identity capture UI is hosted on the Connect page served at
`/connect/:id`. The page binds the connected address as the active account and
does nothing else. The internal Account card reads wallet asset balances for any
address from public on-chain data through `ui.open_account`
(no wallet connection required). The local review funnel is private local data and is available only
through the MCP read tools (`read.summarize_review_funnel`,
`read.list_review_activity`); it has no browser page. State-changing wallet APIs
are unchanged:

- `POST /api/wallet/:id/opened`
- `POST /api/wallet/:id/connecting`
- `POST /api/wallet/:id/result`

All state-changing endpoints require Host and Origin validation plus the wallet session token. The token is supplied with `x-say-ur-intent-token`; query-string tokens are not accepted.

## MCP Boundary

MCP exposes:

- `session.create_wallet_identity`
- `session.get_wallet_identity`
- `session.wait_wallet_identity`
- `session.get_interaction_status`

These tools create, poll, wait on, and summarize local wallet identity interactions. They do not expose private keys, executable transaction material, or arbitrary wallet operations.

`session.create_wallet_identity` returns `openTarget: "system_browser"` and `accessScope: "same_machine_loopback"`.

These fields let clients distinguish the wallet URL opening target from the session status.

`accessScope` combines the same-machine requirement with the loopback-bound review server.

`session.get_wallet_identity` returns the wallet identity session status only.

`session.wait_wallet_identity` is a bounded wait over the same in-memory session state. `timed_out` means the user has not finished yet.

After an AI client gives the wallet URL to the user, it should immediately call `session.wait_wallet_identity` in the same turn or poll `session.get_wallet_identity`.

It should not wait for the user to return and say they connected before checking the session.

AI clients should then call `account.get_active_account` before telling the user which address is currently active.

Pending wallet identity sessions are process-local. If the local MCP server restarts, pending wallet identity sessions are not recovered. The durable state is the active account context stored after a successful connection.

## Testing Boundary

Server-path smoke tests may create a wallet identity session, post a public smoke address to the result endpoint, and then call wallet-account read tools.

That verifies server routing and read-tool integration only.

Browser wallet verification is a separate manual release checklist and is the only check that verifies a real wallet popup.

Local event logs must not write captured wallet addresses in plaintext. NDJSON event logs hash wallet addresses before writing them.
