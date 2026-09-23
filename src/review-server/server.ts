import type { PublicChainReceiptResult } from "../core/action/suiChainReceiptReader.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  FAILURE_REASONS,
  type ExecutionResult,
  type FailureReason,
  type ReviewSession
} from "../core/action/types.js";
import {
  finalizePendingExecutionResultFromChain,
  getReviewSessionWithLazyChainReceiptFinalization,
  type ChainReceiptVerifier
} from "../core/session/chainReceiptFinalization.js";
import type { ActivityStore } from "../core/activity/activityStore.js";
import type { LocalDataService } from "../core/activity/localDataService.js";
import type { LocalSettingsService } from "../core/preferences/preferencesStore.js";
import {
  computeReviewStateWithPrivateArtifacts,
  type ReviewComputationDeps
} from "../core/review/reviewComputation.js";
import { SessionStoreError, type SessionStore } from "../core/session/sessionStore.js";
import { getExecutionPollingStatus } from "../core/session/status.js";
import {
  walletIdentityResultInputSchema,
  walletIdentityPollingHint,
  type WalletIdentitySession
} from "../core/session/walletIdentity.js";
import { parseSuiAddress } from "../core/suiAddress.js";
import type { Logger } from "../runtime/logger.js";
import { validateHostOrigin } from "./middleware/hostOrigin.js";
import { readReviewToken } from "./middleware/reviewToken.js";
import { defaultReviewAssetsDir, serveReviewAsset } from "./assets.js";
import {
  connectHtml,
  reviewHtml,
  settingsHtml
} from "./html.js";
import { HttpError, readJsonBody, sendHtml, sendJson } from "./http.js";
import { ALLOWED_HOSTNAMES, SUI_BROWSER_EXECUTION_ORIGIN } from "./reviewServerPolicy.js";
import { routeSettingsApi } from "./settingsApi.js";

type ReviewHttpServerOptions = {
  host: "127.0.0.1";
  store: SessionStore;
  logger: Logger;
  reviewAssetsDir?: string;
  activityStore?: ActivityStore | undefined;
  localSettings?: LocalSettingsService | undefined;
  localData?: LocalDataService | undefined;
  chainReceiptVerifier?: ChainReceiptVerifier | undefined;
  publicChainReceiptReader?: ((input: { digest: string; now: Date }) => Promise<PublicChainReceiptResult>) | undefined;
  reviewComputationDeps?: ReviewComputationDeps | undefined;
  serverInfo?: {
    name: string;
    version: string;
    network: "mainnet";
  } | undefined;
};

type StartedReviewServer = {
  host: "127.0.0.1";
  port: number;
  close(): Promise<void>;
};

export function createReviewRequestHandler(options: ReviewHttpServerOptions) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      await routeRequest(request, response, options);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.code });
        return;
      }
      options.logger.error("review server request failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      sendJson(response, 500, { error: "internal_error" });
    }
  };
}

export function createReviewHttpServer(options: ReviewHttpServerOptions) {
  const handler = createReviewRequestHandler(options);
  const server = createServer((request, response) => { void handler(request, response); });

  return {
    start(port: number): Promise<StartedReviewServer> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, options.host, () => {
          const address = server.address() as AddressInfo;
          resolve({
            host: options.host,
            port: address.port,
            close: () =>
              new Promise<void>((closeResolve, closeReject) => {
                server.close((error) => (error ? closeReject(error) : closeResolve()));
              })
          });
        });
      });
    }
  };
}


async function requireWalletIdentityToken(
  store: SessionStore,
  sessionId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<string | undefined> {
  const token = readReviewToken(request.headers);
  if (!token || !(await store.validateWalletIdentityToken(sessionId, token))) {
    sendJson(response, 401, { error: "invalid_wallet_token" });
    return undefined;
  }
  return token;
}

async function requireReviewSessionToken(
  store: SessionStore,
  sessionId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<string | undefined> {
  const token = readReviewToken(request.headers);
  if (!token || !(await store.validateReviewToken(sessionId, token))) {
    sendJson(response, 401, { error: "invalid_review_token" });
    return undefined;
  }
  return token;
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ReviewHttpServerOptions
): Promise<void> {
  // Structural guard: every request to this server passes the Host/Origin
  // policy once, so a new route cannot accidentally skip it.
  const hostOrigin = validateHostOrigin(request, { allowedHostnames: ALLOWED_HOSTNAMES });
  if (!hostOrigin.ok) {
    sendJson(response, hostOrigin.status, { error: hostOrigin.reason });
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");

  // Structural guard: the session token only ever rides in the URL fragment and
  // is sent as the x-say-ur-intent-token header, never as a query parameter. A
  // token in the query is rejected here for every route, so no public or token
  // route — current or future — can accidentally accept one.
  if (url.searchParams.has("token")) {
    sendJson(response, 400, { error: "token_query_not_supported" });
    return;
  }

  const reviewMatch = /^\/review\/([^/]+)$/.exec(url.pathname);
  const apiReviewMatch = /^\/api\/review\/([^/]+)$/.exec(url.pathname);
  const apiReviewOpenedMatch = /^\/api\/review\/([^/]+)\/opened$/.exec(url.pathname);
  const apiReviewStateMatch = /^\/api\/review\/([^/]+)\/state$/.exec(url.pathname);
  const apiReviewResultMatch = /^\/api\/review\/([^/]+)\/result$/.exec(url.pathname);
  const apiResultMatch = /^\/api\/result\/([^/]+)$/.exec(url.pathname);
  const connectMatch = /^\/connect\/([^/]+)$/.exec(url.pathname);
  const apiReceiptMatch = /^\/api\/receipt$/.exec(url.pathname);
  const apiReviewHandoffMatch = /^\/api\/review\/([^/]+)\/handoff$/.exec(url.pathname);
  const apiReviewHandoffCancelMatch = /^\/api\/review\/([^/]+)\/handoff\/cancel$/.exec(url.pathname);
  const apiWalletOpenedMatch = /^\/api\/wallet\/([^/]+)\/opened$/.exec(url.pathname);
  const apiWalletConnectingMatch = /^\/api\/wallet\/([^/]+)\/connecting$/.exec(url.pathname);
  const apiWalletResultMatch = /^\/api\/wallet\/([^/]+)\/result$/.exec(url.pathname);
  const settingsMatch = /^\/settings\/([^/]+)$/.exec(url.pathname);
  const apiSettingsMatch = /^\/api\/settings\/([^/]+)$/.exec(url.pathname);
  const apiSettingsClearActiveAccountMatch = /^\/api\/settings\/([^/]+)\/clear-active-account$/.exec(url.pathname);
  const apiSettingsSuiGrpcUrlMatch = /^\/api\/settings\/([^/]+)\/sui-grpc-url$/.exec(url.pathname);
  const apiSettingsSuiGrpcUrlDefaultMatch = /^\/api\/settings\/([^/]+)\/sui-grpc-url\/restore-default$/.exec(url.pathname);
  const apiSettingsSuiGraphqlUrlMatch = /^\/api\/settings\/([^/]+)\/sui-graphql-url$/.exec(url.pathname);
  const apiSettingsSuiGraphqlUrlDefaultMatch = /^\/api\/settings\/([^/]+)\/sui-graphql-url\/restore-default$/.exec(url.pathname);
  const apiSettingsLocalDataExportMatch = /^\/api\/settings\/([^/]+)\/local-data\/export$/.exec(url.pathname);
  const apiSettingsLocalDataPreviewMatch = /^\/api\/settings\/([^/]+)\/local-data\/import\/preview$/.exec(url.pathname);
  const apiSettingsLocalDataImportMatch = /^\/api\/settings\/([^/]+)\/local-data\/import$/.exec(url.pathname);
  const apiSettingsLocalDataResetMatch = /^\/api\/settings\/([^/]+)\/local-data\/reset$/.exec(url.pathname);
  const reviewAssetMatch = /^\/review-assets\/(.+)$/.exec(url.pathname);

  if (request.method === "GET" && reviewMatch?.[1]) {
    sendHtml(response, reviewHtml(reviewMatch[1]), {
      "content-security-policy": [
        "default-src 'none'",
        "base-uri 'none'",
        // 'self' for review-server APIs; the Sui fullnode origin for the
        // browser-side signed-transaction submission (see reviewServerPolicy).
        `connect-src 'self' ${SUI_BROWSER_EXECUTION_ORIGIN}`,
        "script-src 'self'",
        // Inline styles are allowed for mermaid's SVG styling; scripts stay 'self'-only.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "form-action 'none'"
      ].join("; ")
    });
    return;
  }

  if (request.method === "GET" && connectMatch?.[1]) {
    sendHtml(response, connectHtml(connectMatch[1]), {
      "content-security-policy": [
        "default-src 'none'",
        "base-uri 'none'",
        // 'self' for review-server APIs; the Sui fullnode origin so the dapp-kit
        // chain client can read mainnet state during wallet connect.
        `connect-src 'self' ${SUI_BROWSER_EXECUTION_ORIGIN}`,
        "script-src 'self'",
        // Inline styles are allowed for mermaid's SVG styling; scripts stay 'self'-only.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "form-action 'none'"
      ].join("; ")
    });
    return;
  }

  if (request.method === "POST" && apiReviewHandoffCancelMatch?.[1]) {
    const sessionId = apiReviewHandoffCancelMatch[1];
    const token = await requireReviewSessionToken(options.store, sessionId, request, response);
    if (!token) {
      return;
    }
    try {
      await options.store.cancelWalletHandoff(sessionId);
      sendJson(response, 200, { cancelled: true });
    } catch (error) {
      if (error instanceof SessionStoreError) {
        sendJson(response, statusForStoreError(error), { error: error.code });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === "POST" && apiReviewHandoffMatch?.[1]) {
    const sessionId = apiReviewHandoffMatch[1];
    const token = await requireReviewSessionToken(options.store, sessionId, request, response);
    if (!token) {
      return;
    }
    const body = await readJsonBody(request);
    const planId = typeof body.planId === "string" ? body.planId : "";
    const account = typeof body.account === "string" ? body.account : "";
    if (!planId || !account) {
      sendJson(response, 400, { error: "input_invalid" });
      return;
    }
    try {
      const handoff = await options.store.prepareWalletHandoff(sessionId, planId, account);
      sendJson(response, 200, handoff as unknown as Record<string, unknown>);
    } catch (error) {
      if (error instanceof SessionStoreError) {
        sendJson(response, statusForStoreError(error), { error: error.code });
        return;
      }
      throw error;
    }
    return;
  }

  // The Review result still consumes this read endpoint. It shares the same
  // receipt reader as the internal card and grants no wallet authority.
  if (request.method === "GET" && apiReceiptMatch) {
    if (!options.publicChainReceiptReader) {
      sendJson(response, 503, { error: "receipt_data_unavailable" });
      return;
    }
    const result = await options.publicChainReceiptReader({
      digest: url.searchParams.get("digest") ?? "",
      now: new Date()
    });
    if (result.status === "invalid_digest") {
      sendJson(response, 400, { error: "digest_invalid" });
    } else if (result.status === "not_found") {
      sendJson(response, 404, { error: "receipt_not_found" });
    } else if (result.status === "unavailable") {
      sendJson(response, 502, { error: "receipt_unavailable" });
    } else {
      sendJson(response, 200, result.receipt as unknown as Record<string, unknown>);
    }
    return;
  }

  if (request.method === "GET" && settingsMatch?.[1]) {
    sendHtml(response, settingsHtml(settingsMatch[1]), {
      "content-security-policy": [
        "default-src 'none'",
        "base-uri 'none'",
        "connect-src 'self'",
        "script-src 'self'",
        // Inline styles are allowed for mermaid's SVG styling; scripts stay 'self'-only.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "form-action 'none'"
      ].join("; ")
    });
    return;
  }

  if (request.method === "GET" && reviewAssetMatch?.[1]) {
    await serveReviewAsset(response, options.reviewAssetsDir ?? defaultReviewAssetsDir(), reviewAssetMatch[1]);
    return;
  }

  if (
    apiSettingsMatch?.[1] ||
    apiSettingsClearActiveAccountMatch?.[1] ||
    apiSettingsSuiGrpcUrlMatch?.[1] ||
    apiSettingsSuiGrpcUrlDefaultMatch?.[1] ||
    apiSettingsSuiGraphqlUrlMatch?.[1] ||
    apiSettingsSuiGraphqlUrlDefaultMatch?.[1] ||
    apiSettingsLocalDataExportMatch?.[1] ||
    apiSettingsLocalDataPreviewMatch?.[1] ||
    apiSettingsLocalDataImportMatch?.[1] ||
    apiSettingsLocalDataResetMatch?.[1]
  ) {
    await routeSettingsApi(request, response, options, url, {
      status: apiSettingsMatch?.[1],
      clearActiveAccount: apiSettingsClearActiveAccountMatch?.[1],
      setSuiGrpcUrl: apiSettingsSuiGrpcUrlMatch?.[1],
      restoreDefaultSuiGrpcUrl: apiSettingsSuiGrpcUrlDefaultMatch?.[1],
      setSuiGraphqlUrl: apiSettingsSuiGraphqlUrlMatch?.[1],
      restoreDefaultSuiGraphqlUrl: apiSettingsSuiGraphqlUrlDefaultMatch?.[1],
      exportLocalData: apiSettingsLocalDataExportMatch?.[1],
      previewImport: apiSettingsLocalDataPreviewMatch?.[1],
      importLocalData: apiSettingsLocalDataImportMatch?.[1],
      resetLocalData: apiSettingsLocalDataResetMatch?.[1]
    });
    return;
  }

  if (request.method === "GET" && apiReviewMatch?.[1]) {
    const sessionId = apiReviewMatch[1];
    const session = await requireLazyFinalizedReviewSession(options, sessionId, request, response);
    if (!session) {
      return;
    }
    const activeAccount = options.activityStore ? await options.activityStore.getActiveAccount() : undefined;
    sendJson(response, 200, {
      reviewSessionId: session.id,
      internalStatus: session.status,
      pollingStatus: getExecutionPollingStatus(session),
      lastActivityAt: session.lastActivityAt,
      ...(session.expiresAt ? { sessionExpiresAt: session.expiresAt } : {}),
      ...(session.executionResult ? { executionResult: session.executionResult } : {}),
      signingInProgress: session.pendingHandoffDigest !== undefined,
      activeAccount: activeAccount
        ? {
            account: activeAccount.address,
            source: activeAccount.source,
            setAt: activeAccount.setAt,
            ...(activeAccount.walletName ? { walletName: activeAccount.walletName } : {}),
            ...(activeAccount.walletId ? { walletId: activeAccount.walletId } : {})
          }
        : undefined,
      reviewState: session.reviewState,
      plans: session.plans
    });
    return;
  }

  if (
    request.method === "POST" &&
    (apiWalletOpenedMatch?.[1] || apiWalletConnectingMatch?.[1] || apiWalletResultMatch?.[1])
  ) {

    const sessionId = apiWalletOpenedMatch?.[1] ?? apiWalletConnectingMatch?.[1] ?? apiWalletResultMatch?.[1];
    if (!sessionId) {
      throw new HttpError(404, "not_found");
    }
    const token = await requireWalletIdentityToken(options.store, sessionId, request, response);
    if (!token) {
      return;
    }

    let session: WalletIdentitySession;
    if (apiWalletOpenedMatch?.[1]) {
      session = await mapStoreError(() => options.store.recordWalletIdentityOpened(sessionId));
    } else if (apiWalletConnectingMatch?.[1]) {
      session = await mapStoreError(() => options.store.recordWalletIdentityConnecting(sessionId));
    } else {
      const body = await readJsonBody(request);
      const parsed = walletIdentityResultInputSchema.safeParse(body);
      if (!parsed.success) {
        sendJson(response, 400, { error: "input_invalid" });
        return;
      }
      session = await mapStoreError(() => options.store.recordWalletIdentityResult(sessionId, parsed.data));
    }

    sendJson(response, 200, publicWalletIdentitySession(session));
    return;
  }

  if (request.method === "POST" && apiReviewOpenedMatch?.[1]) {

    const sessionId = apiReviewOpenedMatch[1];
    const token = await requireReviewSessionToken(options.store, sessionId, request, response);
    if (!token) {
      return;
    }

    const session = await mapStoreError(() => options.store.recordReviewPageOpened(sessionId));
    sendJson(response, 200, {
      reviewSessionId: session.id,
      internalStatus: session.status,
      pollingStatus: getExecutionPollingStatus(session),
      lastActivityAt: session.lastActivityAt
    });
    return;
  }

  if (request.method === "POST" && apiReviewStateMatch?.[1]) {

    const sessionId = apiReviewStateMatch[1];
    const token = await requireReviewSessionToken(options.store, sessionId, request, response);
    if (!token) {
      return;
    }

    const body = await readJsonBody(request);
    const account = typeof body.account === "string" ? body.account : undefined;
    const planId = typeof body.planId === "string" ? body.planId : undefined;
    if (!account || !planId) {
      sendJson(response, 400, { error: "input_invalid" });
      return;
    }
    const normalizedAccount = parseSuiAddress(account);
    if (!normalizedAccount) {
      sendJson(response, 400, { error: "input_invalid" });
      return;
    }

    const session = await options.store.getReviewSession(sessionId);
    if (!session) {
      sendJson(response, 404, { error: "session_not_found" });
      return;
    }
    const plan = session.plans.find((candidate) => candidate.id === planId);
    if (!plan) {
      sendJson(response, 400, { error: "plan_not_in_session" });
      return;
    }

    await mapStoreError(() => options.store.recordWalletConnected(sessionId, normalizedAccount));
    const computed = await computeReviewStateWithPrivateArtifacts(
      {
        reviewSessionId: sessionId,
        plan,
        account: normalizedAccount
      },
      options.reviewComputationDeps
    );
    const updatedSession = await mapStoreError(() =>
      options.store.recordReviewStateWithArtifacts(
        sessionId,
        computed.state,
        computed.privateArtifacts
      )
    );
    sendJson(response, 200, { reviewState: updatedSession.reviewState });
    return;
  }

  if (request.method === "POST" && apiReviewResultMatch?.[1]) {

    const sessionId = apiReviewResultMatch[1];
    const token = await requireReviewSessionToken(options.store, sessionId, request, response);
    if (!token) {
      return;
    }

    const body = await readJsonBody(request);
    const planId = typeof body.planId === "string" ? body.planId : undefined;
    if (body.status === "success") {
      sendJson(response, 400, { error: "input_invalid" });
      return;
    }
    const status =
      body.status === "signed_pending_result" ||
      body.status === "failure"
        ? body.status
        : undefined;
    if (!planId || !status) {
      sendJson(response, 400, { error: "input_invalid" });
      return;
    }

    const failureReason = typeof body.failureReason === "string" ? body.failureReason : undefined;
    const txDigest = typeof body.txDigest === "string" ? body.txDigest : undefined;
    const resultBase = {
      reviewSessionId: sessionId,
      planId,
      recordedAt: new Date().toISOString()
    };
    let result: ExecutionResult;
    if (status === "failure") {
      if (!isFailureReason(failureReason) || txDigest !== undefined) {
        sendJson(response, 400, { error: "input_invalid" });
        return;
      }
      result = { ...resultBase, status, failureReason };
    } else {
      if (failureReason !== undefined) {
        sendJson(response, 400, { error: "input_invalid" });
        return;
      }
      if (!txDigest) {
        sendJson(response, 400, { error: "input_invalid" });
        return;
      }
      result = { ...resultBase, status, txDigest };
    }
    const updatedSession = await mapStoreError(() =>
      options.store.recordExecutionResult(sessionId, result)
    );
    const finalizedSession = status === "signed_pending_result"
      ? await mapStoreError(() =>
          finalizePendingExecutionResultFromChain({
            sessions: options.store,
            chainReceiptVerifier: options.chainReceiptVerifier
          }, updatedSession)
        )
      : updatedSession;
    sendJson(response, 200, { executionResult: finalizedSession.executionResult });
    return;
  }

  if (request.method === "GET" && apiResultMatch?.[1]) {
    const sessionId = apiResultMatch[1];
    const session = await requireLazyFinalizedReviewSession(options, sessionId, request, response);
    if (!session) {
      return;
    }
    sendJson(response, 200, {
      reviewSessionId: session.id,
      status: getExecutionPollingStatus(session),
      lastActivityAt: session.lastActivityAt,
      executionResult: session.executionResult
    });
    return;
  }
  sendJson(response, 404, { error: "not_found" });
}

async function requireLazyFinalizedReviewSession(
  options: ReviewHttpServerOptions,
  sessionId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<ReviewSession | undefined> {
  const token = await requireReviewSessionToken(options.store, sessionId, request, response);
  if (!token) {
    return undefined;
  }
  const session = await readReviewSessionForHttp(options, sessionId, response);
  if (!session) {
    return undefined;
  }
  return session;
}

async function readReviewSessionForHttp(
  options: ReviewHttpServerOptions,
  sessionId: string,
  response: ServerResponse
): Promise<ReviewSession | undefined> {
  const session = await getReviewSessionWithLazyChainReceiptFinalization(
    {
      sessions: options.store,
      chainReceiptVerifier: options.chainReceiptVerifier
    },
    sessionId
  );
  if (!session) {
    sendJson(response, 404, { error: "session_not_found" });
    return undefined;
  }
  return session;
}

async function mapStoreError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SessionStoreError) {
      throw new HttpError(statusForStoreError(error), error.code);
    }
    throw error;
  }
}

function statusForStoreError(error: SessionStoreError): number {
  switch (error.code) {
    case "active_account_not_set":
      return 409;
    case "input_invalid":
      return 400;
    case "invalid_session_transition":
    case "execution_result_finalized":
    case "signed_pending_result_conflict":
      return 409;
    case "plan_not_in_session":
    case "session_mismatch":
      return 400;
    case "handoff_unavailable":
    case "handoff_commitment_mismatch":
      return 409;
    case "session_expired":
      return 410;
    case "session_not_found":
      return 404;
    default:
      return assertNever(error.code);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled store error code: ${String(value)}`);
}

function isFailureReason(value: string | undefined): value is FailureReason {
  return value !== undefined && (FAILURE_REASONS as readonly string[]).includes(value);
}


function publicWalletIdentitySession(session: WalletIdentitySession) {
  return {
    walletSessionId: session.id,
    status: session.status,
    account: session.status === "connected" ? session.account : undefined,
    chain: session.status === "connected" ? session.chain : undefined,
    walletName:
      session.status === "connected" || session.status === "rejected" || session.status === "failed"
        ? session.walletName
        : undefined,
    walletId:
      session.status === "connected" || session.status === "rejected" || session.status === "failed"
        ? session.walletId
        : undefined,
    failureReason:
      session.status === "rejected" || session.status === "failed" ? session.failureReason : undefined,
    failureDetail:
      session.status === "rejected" || session.status === "failed" ? session.failureDetail : undefined,
    expiresAt: session.expiresAt,
    lastActivityAt: session.lastActivityAt,
    pollingHint: walletIdentityPollingHint()
  };
}
