import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ActivityStore } from "../core/activity/activityStore.js";
import type { LocalDataService } from "../core/activity/localDataService.js";
import type { LocalSettingsService } from "../core/preferences/preferencesStore.js";
import type { SessionStore } from "../core/session/sessionStore.js";
import type { Logger } from "../runtime/logger.js";
import { validateHostOrigin } from "./middleware/hostOrigin.js";
import { defaultReviewAssetsDir, serveReviewAsset } from "./assets.js";
import { settingsHtml } from "./html.js";
import { HttpError, sendHtml, sendJson } from "./http.js";
import { ALLOWED_HOSTNAMES } from "./reviewServerPolicy.js";
import { routeSettingsApi, type SettingsApiMatches } from "./settingsApi.js";

type ReviewHttpServerOptions = {
  host: "127.0.0.1"; store: SessionStore; logger: Logger; reviewAssetsDir?: string;
  activityStore?: ActivityStore | undefined; localSettings?: LocalSettingsService | undefined;
  localData?: LocalDataService | undefined;
  serverInfo?: { name: string; version: string; network: "mainnet" } | undefined;
};

export function createReviewRequestHandler(options: ReviewHttpServerOptions) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const source = validateHostOrigin(request, { allowedHostnames: ALLOWED_HOSTNAMES });
      if (!source.ok) { sendJson(response, source.status, { error: source.reason }); return; }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.searchParams.has("token")) { sendJson(response, 400, { error: "token_query_not_supported" }); return; }
      const settings = /^\/settings\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && settings?.[1]) {
        sendHtml(response, settingsHtml(settings[1]), { "content-security-policy": [
          "default-src 'none'", "base-uri 'none'", "connect-src 'self'", "script-src 'self'",
          "style-src 'self'", "img-src 'self' data:", "form-action 'none'"
        ].join("; ") }); return;
      }
      const asset = /^\/review-assets\/(.+)$/.exec(url.pathname);
      if (request.method === "GET" && asset?.[1]) {
        await serveReviewAsset(response, options.reviewAssetsDir ?? defaultReviewAssetsDir(), asset[1]); return;
      }
      const route = /^\/api\/settings\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
      if (route?.[1]) {
        const routes: Record<string, keyof SettingsApiMatches> = {
          "": "status", "clear-active-account": "clearActiveAccount", "sui-grpc-url": "setSuiGrpcUrl",
          "sui-grpc-url/restore-default": "restoreDefaultSuiGrpcUrl", "sui-graphql-url": "setSuiGraphqlUrl",
          "sui-graphql-url/restore-default": "restoreDefaultSuiGraphqlUrl", "local-data/export": "exportLocalData",
          "local-data/import/preview": "previewImport", "local-data/import": "importLocalData", "local-data/reset": "resetLocalData"
        };
        const match = routes[route[2] ?? ""];
        if (match) { await routeSettingsApi(request, response, options, url, { [match]: route[1] }); return; }
      }
      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof HttpError) { sendJson(response, error.status, { error: error.code }); return; }
      options.logger.error("settings request failed", { stage: "settings_http" });
      sendJson(response, 500, { error: "internal_error" });
    }
  };
}

export function createReviewHttpServer(options: ReviewHttpServerOptions) {
  const handler = createReviewRequestHandler(options);
  const server = createServer((request, response) => { void handler(request, response); });
  return {
    start(port: number): Promise<{ host: "127.0.0.1"; port: number; close(): Promise<void> }> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, options.host, () => resolve({ host: options.host, port: (server.address() as AddressInfo).port,
          close: () => new Promise<void>((done, failed) => { server.close((error) => error ? failed(error) : done()); }) }));
      });
    }
  };
}
