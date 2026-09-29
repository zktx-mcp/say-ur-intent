# Frontend Policy

Account, Receipt, Chart, Connect and Review use internal MCP Apps cards.
Settings remains a local session-token page. Cards display backend-validated
facts and forward explicit user selections through scoped app-only tools. They
never hold transaction bytes/signatures or call a wallet, Sui RPC, Indexer or
local HTTP endpoint directly. Direct NFT image loading is the display exception.

## Display and review facts

Show what is happening, the relevant asset flow, whether an action is available,
and its consequences before technical details. Backend status and validated
structured facts are authoritative; AI interpretation, local timers and UI
availability do not establish financial truth. Status/error changes must be
textual, keyboard accessible and screen-reader labeled.

Review primary facts include action, selected account, network, send limit
(`up to` where relevant), expected/minimum receive, status and next action.
`assetFlowPreview` display inputs are proposals, never signing quantities.
Show the final ReviewState failed/warning checks beside the decision.
Human-readable evidence-stage explanatory notes precede final checks; retain them
in labelled preparation details rather than presenting them as current failures. Keep raw integer amounts and
pinned decimals; display signed net gas without clamping a rebate to zero.
Review details include quote time, raw min-out policy, gas budget/breakdown,
simulation effects, object/balance changes and a PTB graph from the same revision.
PTB source labels, timestamps and name/address controls are facts,
not safety or venue recommendations. No text-copy buttons or clipboard fallbacks.

External proposals show source, action, recipients/targets, freshness, missing
evidence, user choices, unsupported claims and nonSignableReason. They never
expose a preparation/signature action or silently choose a settlement asset.

## Connect and Review behavior

SQLite owns card permission/revision/deadline, wallet connections, review
revisions and transaction attempts. A View owns only rendering, local resources
and sequential observation. Chat changes, frame recreation and teardown have no
business-state effect. An initial authenticated DB read is required regardless
of preview rendering success. Missing permission or unknown DB state disables
business actions without inventing a terminal state.

Connect shows wallet state and the selected account. The connected-wallet overview omits the separate Close action; the disconnection confirmation retains Cancel. It keeps pairing explicit, hides additional pairing while connections or connection operations exist, and uses an in-card target-specific Confirm/Cancel step for disconnection. Confirmation is discarded when the card revision or target changes. Connect shows approved accounts and read context. An explicit connection with
one approved account can set read context; multiple accounts require selection.
The stored read context persists separately from default asset-read eligibility. An implicit asset read requires a usable current connection for the selected account; explicit-address reads and stored result reads do not. Clearing read context is not wallet disconnection. Reconciliation alone never
sets it again. A waiting Connect card displays only the same live pairing QR
from metadata bound to card/connection/revision. Missing metadata is shown as
unavailable and never triggers new pairing. Terminal connections cannot be
reactivated by late approval; another operation uses a new card.

Connection facts and the current card operation are separate. A pending
disconnect is projected from the stored accepted action, target and running
card. Show its progress while retaining the last confirmed connection facts,
exclude that connection from new selections, and observe until stored completion
or failure. Do not end observation merely because the last connection status is
connected. Frame recreation reads the same operation without sending it again.
Current reads can recover completion after a storage failure; SDK unavailability
must not be rendered as proof that the remote wallet connection was removed.

Review preparation is separate from final admission. Explicit refresh computes
a new complete review revision and preserves failure information. It does not
consume final selection. If a finished computation could not store its outcome,
current reads can record its failed update and restore the existing update/cancel
choices. The View never restarts computation to repair a progress display.
The sign action requires backend-permitted
ready_for_wallet_review, verified transaction review data, a matching live
account and the user's wallet selection. With exactly one current candidate,
show its wallet and account and use the explicit action button as that selection;
do not require a dropdown. Multiple candidates require an explicit selection.
Preparation and wallet approval remain separate actions. Only the backend sends bytes to the
wallet and verifies its response. A card never reports its own chain result.

Use the backend's preparation choices for account compatibility; do not recreate
that rule in the View. The existing `review.error` text labels current account
selection guidance and any saved previous update error separately. Display it
as neutral explanatory text, not as a new failed state. Lifecycle alerts still
report actual command, transport and display failures. Signing an already valid
review and reading an admitted result retain their own backend permissions.

Before submission, show the stored interruption reason without replacing wallet
events with a user-stop explanation. After submission, a connection change or
disconnect request preserves chain progress; only an explicit transaction stop
ends observation. A later wallet event must not restart user-stopped observation.

| Request state | Card behavior |
| --- | --- |
| No request | Show proposal/review; prepare or refresh when permitted, request wallet approval only when valid, or cancel input |
| awaiting_signature | Show wallet wait; user may stop local waiting, which permanently removes submission permission |
| submitting | Show submission in progress; stopping observation cannot cancel the transaction |
| awaiting_chain_result | Show the exact digest and observation state; stop/resume observation when permitted |
| stopped / request_failed | Show reason, without inventing chain failure; a new signature needs a newly reviewed revision |
| outcome_unknown | Preserve known digest and uncertainty; read the same transaction without resubmitting |
| completed | Show independently verified chain success/failure and receipt facts; no signing input restoration |

Management cards bind an exact reviewSessionId and attemptId. They cannot
change the original deadlines, review selection or submission permission.
A valid saved history is not live management authority. Account/session changes
invalidate pending approval as appropriate; they cannot silently rebind a review.

## Rendering and recovery

Use the shared lifecycle for all cards. A lost action reply reads the same
state once; it never resends the action. Read errors stop automatic observation
and retain previous facts with explicit read recovery. Rendering failures keep
normal DB observation obligations, preserve previous content, and dispose only
new failed resources. A rendering failure is not a reason to repeat the business
query. QR and graph resources are disposed once. Review detail graphs are created
only when their disclosure is opened in the document. Opening details uses the
same saved facts without a new query or action; delayed renders cannot cross
transaction identities. Receipt summaries import no graph renderer. Backend-computed remaining
time triggers a state read, not a client-written expiry reason.

An unadmitted ready Review also uses the backend's `nextStateReadAfterMs` hint
to confirm state at its verified material expiry. Use the earlier positive
interval from that hint and the card authority deadline. Lock business input
until the read resolves; a failed read requires explicit recovery. Countdown
hints do not identify new display content or reset a wallet selection. An
expired review shows the stored refresh reason and explicit update action;
it does not recompute a quote or terminate an already admitted request.

Card state, action choices and timing hints come from the same backend
evaluation. A read conflict caused by changed review evidence preserves the
last display and requires explicit state-read recovery, with inputs and timers
disabled. Prefer the safe error message when supplied; a reason code is not
display copy. Do not recreate a business request or continuously retry a conflict.

Only actions permitted by the current backend state are rendered. During an
in-flight action, disable other business actions while preserving display
controls. Preparation/transport failures and display failures have distinct
messages and recovery. Amounts, slippage, target asset and venue are changed
through a new reviewed proposal, not ad hoc frontend edits.

Connect and Review show `walletAvailability` separately from stored business
facts. Wallet unavailability preserves the displayed review and results, removes
wallet-dependent actions, and does not become a rendering error. A connection
that cannot be checked is labelled as the last recorded status with its update
time. Pairing display data must be removed when the backend no longer supplies
it, even if the card revision is unchanged.

The backend derives `observe` from `progress.status === "waiting"`. Unavailable
progress stops automatic polling and offers an explicit same-card state read;
that read cannot reconnect, sign or resubmit. Existing DB expiry wake-ups remain
independent of progress polling. Availability and allowed actions participate in
display identity; remaining-time hints do not reset input selection.

Local-data counts describe the backend state at the time they are read. A later
replacement warning must not use a stale count, especially zero, as an assurance
that no unconfirmed transaction records will be deleted. Warn that replacement
can remove those records and cannot cancel a transaction on Sui.

## Internal Read Cards

Account and Receipt targets are established in chat, without card input forms. Missing targets produce a concise input-required message with no card record, source request, permissions or polling. The Account card shows SuiNS when available, the actual query address, coin totals, Display NFTs, an omitted-object count, fetched time and enumeration limits for an explicit or connection-qualified default address. The Receipt card shows execution outcome, balance changes, net gas, sender, digest and fetched time. Technical input, object, call, event and PTB details are not rendered in this summary view. Review leads with the same observed-result summary and retains its full receipt and pre-approval evidence in closed, separately labelled disclosures. Reviewed estimates remain distinct from actual chain results. Internal request IDs, revisions and raw JSON dumps are not display requirements. Important failures, warnings and missing choices remain beside the active decision. The Chart card shows one selected DeepBook USDC pair with official intervals, the UTC period and any result-limit notice. Custom date inputs are secondary to existing range shortcuts, and are expanded when supplied boundaries need inspection. Detailed candle numbers are in an accessible disclosure. Candle count is not a form field; supplied limits, defaults and shortcut query values remain unchanged. Its initial time axis uses the saved request boundaries; omitted boundaries use available candle times, and a request without either boundary fits the returned candles. Boundary whitespace carries no price or volume. Empty results show the requested range and an explicit no-candles message. These are read-only views; they create no wallet connection, review approval, trading authority, P&L or fiat valuation.

All read cards use one SQLite-backed input lifecycle and one View lifecycle. The View inserts a result node before invoking its mount callback. Size-dependent renderers wait for positive layout dimensions, ignore hidden zero-size layouts, and release observers and drawing resources on disposal. Chart resizing preserves the current viewport rather than reapplying the initial query range. Initialization reads the same card record. Chat navigation, frame recreation and teardown do not close input or cancel work. A valid unsubmitted selection remains available; admission or backend expiry ends that original input. A read may finish after its View closes. Completed results are static, remain stored until local data replacement/reset, and do not repeat the source query. A different selection after admission needs a new card.

Static presentation may read the same saved result, missing details, or the state of an admitted operation when needed. Such reads do not restore controls or start a new business operation. Polling is sequential, uses the server-provided interval, and stops on completion, view closure or read error. Keep an already displayed result when a later read fails.

The view uses MCP Apps host-mediated tool/resource calls. It does not fetch local HTTP endpoints, Sui RPC or the Indexer directly. App-only permissions travel in UI metadata and never appear in ordinary model content or saved resources. The backend checks permission, card, server expiry and expected revision and admits the selection atomically in SQLite. Identical duplicates return the stored request; conflicting input returns an authenticated current snapshot and an error. Lost replies require a same-card state read, never automatic resubmission.

The View timer uses backend-computed remaining input time and asks for current state at expiry; it does not write an expiry or close reason. Teardown only disposes local observers, timers and rendering resources. Missing UI permission or a failed current-state read keeps input disabled without inventing a terminal state. Preserve previously displayed facts and expose recovery through a saved-state read. Server restart invalidates unfinished input/work without replaying it and preserves completed DB results.

Receipt input values and their PTB graph use a typed UI-only metadata channel bound to card ID, transaction digest and revision. Model text, structured content and public saved resources omit those display details. A view displaying private receipt details must mark missing details as unavailable, not as an absence of transaction inputs. The standalone Receipt summary does not display those technical sections. Rendering uses the validated receipt. NFT image loading remains the permitted direct external-display exception; business queries still go through the backend.

Internal cards provide no clipboard actions, copy buttons, or clipboard fallback controls. Preserve readable facts and ordinary text selection; where a PTB graph is shown, preserve its name/address controls and pan/zoom. NFT images retain no-referrer behavior and a failed-image placeholder. Theme follows the host. Card view cleanup ends timers, subscriptions and rendering observers without cancelling an already admitted server operation.

All five cards, including Review management, adapt to the embedded frame width.
Forms wrap, narrow fact rows stack their label above the value, and long addresses,
amounts, names and records remain readable without widening the document. QR,
chart and PTB drawing areas stay within the card; resizing changes presentation
without repeating a business query or changing stored state. Responsive rules
for shared atoms remain in the shared stylesheet.

## Language

Use short, direct, non-promotional copy. Stable cards do not repeat generic
"Saved result" or "Stored request state" labels above their actual facts.
Lifecycle messages describe opening, unavailable current state and recovery;
renderers describe business facts. Show times in UTC with exact values available.
Unknown token decimals mean the display amount is unavailable; do not present
raw integers as user token quantities.

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

The card views and remaining Settings page share one design-token set and one set of atomic UI
components: vanilla TypeScript DOM helpers in `review-app/src/ui` plus the shared
stylesheet `review-app/public/ui.css`, served at `/review-assets/ui.css`. There is
no React, Vue, Svelte, or client router. Views compose the shared atoms and keep
only their own layout, container, third-party-sizing, and composition CSS. The
shared atoms are addressed by `ui-` prefixed classes that only the shared
stylesheet declares; a page stylesheet declares no `ui-` class rule and no bare
button, input, select, or textarea rule.

The shared UI follows these durable principles:

1. Always-actionable controls: every actionable control shows hover, active, and
   keyboard-focus feedback. Controls are inert only during the deliberate,
   clearly-signaled async lock. Status and errors are conveyed as text, not color
   alone.
2. One consistent system: cards share one lifecycle, one component set, and the
   same element positions. Cards and token pages have no cross-page navigation.
3. Cards show the current step and next permitted action without permanently
   listing every earlier step. A completed transaction leads with its observed
   result; stored request state is not a second outcome. Settings preview and
   confirmation requirements are unchanged.
4. Primary result regions keep their position across data availability and show
   an explicit empty or unavailable state. Technical sections intentionally omitted
   from a summary do not require placeholder regions; the Account summary reports
   omitted-object counts only when there are such objects or an enumeration limit.
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

Theme: cards follow the host; the remaining Settings page has a theme toggle. A shared theme helper stores
only the theme value (`light` or `dark`) under one fixed storage key; it never
reads or writes a token, session id, wallet account, or any other state. The
theme is the `data-theme` attribute on the document root and is applied through
CSS variables with no inline styles, so it works under the strictest page CSP.

Icons are SVG files or inline SVG, never an icon font or a CDN. The favicon
(`favicon.svg`) and the theme-specific brand marks (`brand-light.svg`,
`brand-dark.svg`) are served from `/review-assets/`; the header shows the brand
mark for the active theme.

## Navigation

Read cards open from purpose-specific MCP tools. They contain their own result and error states and do not link to removed Account, Receipt, Chart, home or HTML not-found pages. Cards and the Settings page have no cross-page navigation or linked brand exit.

## Security

Tokens must not be accepted in query strings. Wallet addresses must not be written to local event logs in plaintext. Private keys, signatures, transaction bytes, and arbitrary Move calls must not appear in frontend state.

Cards bundle script/style locally with the declared Host CSP and no external execution chunks. The Settings page uses local assets and Host/Origin/session-token checks. App-only tools require scoped UI permission, target and revision checks.

Wallet and review screens must be keyboard reachable and screen-reader labeled. Status and error changes must be exposed as text, not color alone.

Native push notifications are out of scope. A frontend may use low-authority browser affordances such as document title changes for off-tab terminal results, but only after server status changes.

Each card has its own scoped input; live review and session state is shared in SQLite (see LOCAL_DB_ARCHITECTURE.md). Views never share mutable business state directly.

## Out Of Scope

The frontend must not add:

- additional live trading/chart dashboards beyond the read-only Chart card
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
