# Frontend Policy

Say Ur Intent presents Account, Receipt and Chart as internal MCP Apps cards. Connect, Review and Settings use local session-token pages. Every surface displays server-returned facts and keeps AI reasoning separate from wallet authority.

The review server may build local unsigned DeepBook or FlowX swap transaction material during account-bound review. The review page receives bytes only through the digest-gated handoff and offers signing only for a matching account on `ready_for_wallet_review`. Read cards never receive transaction bytes or signatures.

## Role

Current release frontend surfaces may capture wallet identity, display review
state, request refresh when allowed, and report page-local signed-digest or
failure events for server-owned receipt handling. They do not submit wallet
signatures or decide final chain receipt truth.

It is not a trading dashboard, AI chat, portfolio app, alert surface, analytics screen, or safety oracle.

## Display Priority

Show the minimum facts needed for the user's decision first:

1. What is happening?
2. Can the user proceed?
3. What happens if the user proceeds?
4. What is the next action?

Technical details sit in their own cards below the primary decision — always
visible there, never crowding the primary card — with their granular per-record
lists behind compact details controls inside those cards. Raw protocol data must
not dominate the primary screen.

## Information Source

Primary UI may render only server-validated structured data. AI-generated interpretation must not appear as trusted review fact.

The frontend must not compute quote truth, readiness, blocked status, safety, or
final execution truth. In the current release, it may render state, connect a
wallet, ask the server to refresh, revoke wallet identity when that action
exists, and report the signed digest or local failure event that starts
server-owned receipt handling. The Receipt card renders only server-read receipt facts and does not call Sui RPC, dapp-kit, or wallet APIs.

## Wallet Identity

Wallet identity is the product path for active-account reads and account-bound review. Manual address entry is not a product path for the review UI or wallet identity flow. MCP explicit-address inputs for public coin balance snapshots are separate read-only tool inputs and do not create active account context.

Sender-independent DeepBook market reads do not require wallet identity. Wallet identity capture is not signing authorization.

The user must be able to see the active wallet account when connected.

Reusable identity sessions may set an ambient read context after the user connects a wallet. This read context remains until the user clears it or replaces it with another wallet identity. It must be presented as active account context, not login, signing authorization, custody, or permission for transactions.

When a wallet exposes multiple accounts, Say Ur Intent captures the account returned by the wallet connection result. The UI must display that account clearly. Choosing a different account requires replacing the active account context with another wallet identity connection.

## Review Surface

The review page displays server-computed review state. Each action review is a separate ceremony. The review screen prioritizes asset flow over protocol internals.

Required primary facts:

- action summary
- send amount
- expected receive or minimum receive
- current review status
- next action

When a user can spend more than the displayed send amount, the top-level asset flow must show the spend limit with explicit language such as `up to`. Do not hide max spend in secondary details when it changes the user's decision.

`assetFlowPreview` entries with `amountKind: "display_intent"` are display-only proposal facts. They are different from review-time `assetFlowActual`, simulation summaries, and balance changes, and the frontend must not use them as signing input, minimum receive, or transaction-building input.

When a plan includes `reviewModel`, the review page must show the external
proposal source, proposed action, asset flow, recipient or target, freshness,
missing evidence, required user choices, unsupported claims, blocking checks,
and `nonSignableReason`. These fields are review annotations only. They are not
transaction material. They are not route selection or settlement-token
selection. They are not wallet readiness, signing readiness, or execution
safety.

In the current release, the review page reconnects the bound active account, reloads the active account context, and requests account-bound review computation. It does not create a wallet identity session; wallet identity sessions are created only on the Connect page.

It renders server-returned review checks for the resolved direct pool, raw quote evidence, quote freshness, derived raw min-out policy, DEEP fee raw evidence, and internal digest commitment.
It may also render a server-returned check that local unsigned DeepBook swap
transaction material was built and kept internal to the review server.
It may render `reviewState.humanReadableReview` when the server returns it. That
summary is displayable review evidence projected from server-verified private
review artifacts. The frontend must not recompute its quote truth, object
ownership, freshness, blocked status, or readiness.
It may render `reviewState.simulation` when the server returns it. That summary
is a redacted projection from private review-time simulation evidence for stored
local transaction material. The frontend must not recompute simulation truth.
The frontend must not extract transaction bytes or a public digest from it.
The frontend must not treat it as wallet readiness or signing readiness.
The frontend must not treat it as execution readiness or proof of wallet
submission.

It must keep those checks as review evidence only.
It must not treat them as public transaction bytes, wallet readiness, signing readiness, route quality, or execution safety.

Compact secondary facts:

- venue or protocol
- quote timestamp
- gas estimate when available
- max spend when available

Details:

- pool ID
- package ID
- object changes
- balance changes
- simulation summary
- Review checks

Review checks are generally details. Failed checks and warning checks that determine the current `blocked` or `refresh_required` status must be elevated next to the status banner so the user can understand the reason without opening details.

If the server returns a `PtbVisualizationArtifact`, the frontend may render only
Mermaid flowchart text plus diagnostics. The panel must show the generated time,
source, diagnostics, and unsupported-use boundary when those fields are present.
The Mermaid graph may show a registered Move Registry package name in place of a
registered package address, with a control to switch back to raw addresses; that name is a package identity
label, not a safety, trust, route-quality, or signing-readiness signal, and any
package that is not registered keeps its raw address.
It must not store or render executable transaction material, wallet signature
requests, private-key material, or arbitrary Move calls. A PTB graph is not a
sign action, not a transaction-building action, not a wallet readiness signal,
not a signing readiness signal, not a payment execution readiness signal, not a
route-quality signal, and not an execution-safety signal.

## Current Release State Rules

The review page is a state wizard with two displayed phases (Ready, Result)
over nine page states. Every state keeps the same constant layout: the phase
indicator, a one-line state headline, the constant Transaction card
(plan-level values that fill in with reviewed values), the state-specific
block, and an always-visible Audit record card (its copy-as-Markdown action a
title-bar icon, its record sections behind nested disclosures). The ready state
additionally shows an always-visible Transaction details card (estimated balance
changes, the gas breakdown, and the PTB graph) below the Transaction card. Only
the current state's actions are rendered;
out-of-state buttons are removed, not disabled.

The sign action appears only on `ready_for_wallet_review` with an emitted
wallet review contract, a connected wallet whose account equals the reviewed
account, and a successful digest-gated handoff. The signing step shows no wallet picker:
dapp-kit autoconnect restores the wallet recorded for the active account on the
fixed-port origin, and the sign action stays gated on the connected account
matching the reviewed account. When autoconnect cannot establish a connection -
for example after a reload or in a new tab, or for a hardware signer whose
device session is not restored automatically - the signing step may offer a
targeted reconnect for the one recorded wallet. That reconnect is not a wallet
picker: it resumes the recorded wallet's signer session, and the sign action
stays gated on the connected account matching the reviewed account. While a handoff is outstanding the server locks the session
(state recomputes are refused) and the page shows a signing-in-progress state
whose only action is cancel. Other states render:

- `refresh_required` and an expired quote: hide the sign action and show the
  refresh action with the safe-funds copy.
- `blocked`: hide the sign action and show a human-readable reason plus the
  retry action.
- recorded execution result: show the receipt card (status, digest, failure
  reason, and server-read chain receipt facts when present) with no review or
  sign actions; the session is finished. The receipt card shows the server-read
  chain receipt facts inline; the Receipt card can also read
  on-chain receipt facts by transaction digest.
- `expired`: show expiration and a concrete restart path. The default restart path is to return to the AI client and request a new wallet identity or review session.

External proposal review sessions are non-signable. Their primary action is to
inspect the review facts and return to the AI client with any remaining user
choices.

## Internal Read Cards

The Account card shows SuiNS, coin balances, Display NFTs, other owned objects, fetched time and enumeration limits for an explicit or active read address. The Receipt card shows server-read facts for one transaction digest, including gas, balance changes, objects, inputs, events and PTB visualization. The Chart card shows one selected DeepBook USDC pool with official intervals, UTC range and candle limits. Its initial time axis uses the saved request boundaries; omitted boundaries use available candle times, and a request without either boundary fits the returned candles. Boundary whitespace carries no price or volume. Empty results show the requested range and an explicit no-candles message. These are read-only views; they create no wallet connection, review approval, trading authority, P&L or fiat valuation.

All read cards use one SQLite-backed input lifecycle and one View lifecycle. The View inserts a result node before invoking its mount callback. Size-dependent renderers wait for positive layout dimensions, ignore hidden zero-size layouts, and release observers and drawing resources on disposal. Chart resizing preserves the current viewport rather than reapplying the initial query range. Initialization reads the same card record. Chat navigation, frame recreation and teardown do not close input or cancel work. A valid unsubmitted selection remains available; admission or backend expiry ends that original input. A read may finish after its View closes. Completed results are static, remain stored until local data replacement/reset, and do not repeat the source query. A different selection after admission needs a new card.

Static presentation may read the same saved result, missing details, or the state of an admitted operation when needed. Such reads do not restore controls or start a new business operation. Polling is sequential, uses the server-provided interval, and stops on completion, view closure or read error. Keep an already displayed result when a later read fails.

The view uses MCP Apps host-mediated tool/resource calls. It does not fetch local HTTP endpoints, Sui RPC or the Indexer directly. App-only permissions travel in UI metadata and never appear in ordinary model content or saved resources. The backend checks permission, card, server expiry and expected revision and admits the selection atomically in SQLite. Identical duplicates return the stored request; conflicting input returns an authenticated current snapshot and an error. Lost replies require a same-card state read, never automatic resubmission.

The View timer uses backend-computed remaining input time and asks for current state at expiry; it does not write an expiry or close reason. Teardown only disposes local observers, timers and rendering resources. Missing UI permission or a failed current-state read keeps input disabled without inventing a terminal state. Preserve previously displayed facts and expose recovery through a saved-state read. Server restart invalidates unfinished input/work without replaying it and preserves completed DB results.

Receipt input values and their PTB graph use a typed UI-only metadata channel bound to card ID, transaction digest and revision. Model text, structured content and public saved resources omit those display details. Missing private details must be shown as unavailable, not as an absence of transaction inputs. Rendering uses the validated receipt. NFT image loading remains the permitted direct external-display exception; business queries still go through the backend.

Internal cards provide no clipboard actions, copy buttons, or clipboard fallback controls. Preserve readable facts, ordinary text selection, PTB name/address display controls and graph pan/zoom. NFT images retain no-referrer behavior and a failed-image placeholder. Theme follows the host. Card view cleanup ends timers, subscriptions and rendering observers without cancelling an already admitted server operation.

## Actions

Each state should expose at most one primary action.

The review page may show an account-bound review action when an active account is present and no review state has been recorded for the selected plan.

It may also show that action when the server status requires refreshed account-bound evidence.

That action asks the local review server to compute review state.
It is not a sign action, frontend transaction-building action, wallet readiness signal, signing readiness signal, or route-quality signal.

Do not show a quote/evidence refresh button unless the quote expired, the
status is `refresh_required`, or no review state has been recorded yet.

Do not automatically close tabs after terminal results. Do not silently renew identity sessions. Do not edit amount, slippage, target asset, or venue on the frontend; revisions go back through AI and MCP.

Loading and waiting states must use plain status copy. For wallet identity, use copy such as `Finish or cancel the request in your wallet popup`. For signing, keep the user's attention on the wallet popup and do not add extra choices.

If a terminal or unrecoverable frontend error occurs, show one clear message and one recovery route. Examples: invalid token, missing session, expired session, unsupported chain, or no compatible wallet.

## Language

Use short, direct, non-promotional copy.

Do not say:

- safe
- recommended
- best
- guaranteed
- approved by AI

Prefer:

- ready for wallet review
- refresh required
- blocked
- expected receive
- minimum receive
- checked at

Source fields may keep protocol-facing names such as `fetchedAt`. Frontend labels should map them to user-facing copy such as `checked at`.

Frontend labels stay in English. Localization must preserve protocol names, token symbols, object IDs, package IDs, and reason enums without translation.

## Shared UI And Design Principles

The frontend pages share one design-token set and one set of atomic UI
components: vanilla TypeScript DOM helpers in `review-app/src/ui` plus the shared
stylesheet `review-app/public/ui.css`, served at `/review-assets/ui.css`. There is
no React, Vue, Svelte, or client router. Pages compose the shared atoms and keep
only their own layout, container, third-party-sizing, and composition CSS. The
shared atoms are addressed by `ui-` prefixed classes that only the shared
stylesheet declares; a page stylesheet declares no `ui-` class rule and no bare
button, input, select, or textarea rule.

The shared UI follows these durable principles:

1. Always-actionable controls: every actionable control shows hover, active, and
   keyboard-focus feedback. Controls are inert only during the deliberate,
   clearly-signaled async lock. Status and errors are conveyed as text, not color
   alone.
2. One consistent system: all pages share one shell, one component set, and the
   same element positions. Public pages carry the shared navigation; token pages
   carry none.
3. Multi-step pages show their full set of steps and mark the current step.
4. A region keeps its position across state and data availability; when content is
   empty, unsupported, or unavailable, the region shows a placeholder card in its
   place rather than collapsing or restructuring the layout.
5. Time-based progress and quantitative completeness use different components: a
   progress bar only when a real value advances it, an indeterminate overlay for
   an unknown-duration wait, and a count plus checklist for an already-known
   "N of M".
6. An action's result or error is tied to that action, stays visible, and carries
   enough detail to diagnose afterward.
7. Restraint: each page shows only the information it needs, with generous spacing.
8. Information depth by importance: each page ranks its information and renders the
   primary answer first and most prominent, audit and technical detail in their
   own cards below the primary with granular records behind disclosures, and
   boundary notes quiet, using a two-weight type scale (regular and medium) where
   size, color, and spacing carry the hierarchy.

Theme: one light and dark token set with a toggle. A shared theme helper stores
only the theme value (`light` or `dark`) under one fixed storage key; it never
reads or writes a token, session id, wallet account, or any other state. The
theme is the `data-theme` attribute on the document root and is applied through
CSS variables with no inline styles, so it works under the strictest page CSP.

Icons are SVG files or inline SVG, never an icon font or a CDN. The favicon
(`favicon.svg`) and the theme-specific brand marks (`brand-light.svg`,
`brand-dark.svg`) are served from `/review-assets/`; the header shows the brand
mark for the active theme.

## Navigation

Read cards open from purpose-specific MCP tools. They contain their own result and error states and do not link to removed Account, Receipt, Chart, home or HTML not-found pages. Connect, Review and Settings pages have no cross-page navigation or linked brand exit.

## Security

Tokens must not be accepted in query strings. Wallet addresses must not be written to local event logs in plaintext. Private keys, signatures, transaction bytes, and arbitrary Move calls must not appear in frontend state.

CSP should prefer external assets and avoid inline script or inline style. Host, Origin, and session token validation are mandatory for state-changing APIs.

Wallet and review screens must be keyboard reachable and screen-reader labeled. Status and error changes must be exposed as text, not color alone.

Native push notifications are out of scope. A frontend may use low-authority browser affordances such as document title changes for off-tab terminal results, but only after server status changes.

Each session URL represents one independent tab surface. Live review and session state is shared across local clients through a shared SQLite database (see docs/LOCAL_DB_ARCHITECTURE.md); the frontend itself does not share state directly between browser tabs.

## Out Of Scope

The frontend must not add:

- price charts
- candlesticks
- portfolio dashboards
- AI chat
- trading recommendations
- alerts
- automatic transaction history dashboard pages
- multi-wallet comparison
- saved plans or bookmarks
- arbitrary strategy controls

The exclusions above target automatic, background-indexed, or
recommendation-style surfaces. User-requested local record views are allowed
only inside their narrow surfaces: the Account card shows a wallet
asset snapshot at a fetched timestamp for an address from public on-chain reads,
and the Receipt card shows server-read on-chain receipt facts
for one transaction digest. Summaries of locally stored review and activity records are available through the MCP read tools. These views
must not add P&L, valuation, performance, tax claims, or route ranking. They
must not add background indexing.
