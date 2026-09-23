import type { IncomingMessage, ServerResponse } from "node:http";
import type { ActivityStore } from "../core/activity/activityStore.js";
import {
  LocalDataError,
  type LocalDataImportPreview,
  type LocalDataMutationResult,
  type LocalDataService
} from "../core/activity/localDataService.js";
import { LocalSettingsError, type LocalSettingsService } from "../core/preferences/preferencesStore.js";
import type { SessionStore } from "../core/session/sessionStore.js";
import { readReviewToken } from "./middleware/reviewToken.js";
import { HttpError, MAX_JSON_BODY_BYTES, readJsonBody, sendJson } from "./http.js";

const MAX_SETTINGS_BODY_BYTES = MAX_JSON_BODY_BYTES;
const MAX_IMPORT_BODY_BYTES = 16 * 1024 * 1024;

type SettingsApiRouteOptions = {
  store: SessionStore;
  activityStore?: ActivityStore | undefined;
  localSettings?: LocalSettingsService | undefined;
  localData?: LocalDataService | undefined;
  serverInfo?: {
    name: string;
    version: string;
    network: "mainnet";
  } | undefined;
};

export type SettingsApiMatches = {
  status?: string | undefined;
  clearActiveAccount?: string | undefined;
  setSuiGrpcUrl?: string | undefined;
  restoreDefaultSuiGrpcUrl?: string | undefined;
  setSuiGraphqlUrl?: string | undefined;
  restoreDefaultSuiGraphqlUrl?: string | undefined;
  exportLocalData?: string | undefined;
  previewImport?: string | undefined;
  importLocalData?: string | undefined;
  resetLocalData?: string | undefined;
};

export async function routeSettingsApi(
  request: IncomingMessage,
  response: ServerResponse,
  options: SettingsApiRouteOptions,
  _url: URL,
  matches: SettingsApiMatches
): Promise<void> {
  // Host/Origin and a query token are rejected once by the global guards in
  // routeRequest before this handler runs (see the "validate once" guards
  // there), so this handler does not re-check them.
  const settings = requireSettingsDeps(options);
  const sessionId =
    matches.status ??
    matches.clearActiveAccount ??
    matches.setSuiGrpcUrl ??
    matches.restoreDefaultSuiGrpcUrl ??
    matches.setSuiGraphqlUrl ??
    matches.restoreDefaultSuiGraphqlUrl ??
    matches.exportLocalData ??
    matches.previewImport ??
    matches.importLocalData ??
    matches.resetLocalData;
  if (!sessionId) {
    throw new HttpError(404, "not_found");
  }
  const token = readReviewToken(request.headers);
  if (!token || !(await options.store.validateSettingsToken(sessionId, token))) {
    sendJson(response, 401, { error: "invalid_settings_token" });
    return;
  }

  if (request.method === "GET" && matches.status) {
    const [localSettings, activeAccount, dataCounts] = await Promise.all([
      mapLocalSettingsError(() => settings.localSettings.getLocalSettings()),
      settings.activityStore.getActiveAccount(),
      settings.localData.getDataCounts()
    ]);
    sendJson(response, 200, {
      settingsSessionId: sessionId,
      server: settings.serverInfo,
      localSettings,
      activeAccount: activeAccount
        ? {
            account: activeAccount.address,
            source: activeAccount.source,
            setAt: activeAccount.setAt
          }
        : undefined,
      dataCounts,
      restartRequired:
        localSettings.suiGrpcUrl.appliesAfter === "mcp_server_restart" ||
        localSettings.suiGraphqlUrl.appliesAfter === "mcp_server_restart"
    });
    return;
  }

  if (request.method === "POST" && matches.clearActiveAccount) {
    await readJsonBody(request, MAX_SETTINGS_BODY_BYTES);
    await settings.activityStore.clearActiveAccount();
    sendJson(response, 200, { status: "cleared" });
    return;
  }

  if (request.method === "POST" && matches.setSuiGrpcUrl) {
    const body = await readJsonBody(request, MAX_SETTINGS_BODY_BYTES);
    const urlValue = typeof body.url === "string" ? body.url : undefined;
    if (!urlValue) {
      sendJson(response, 400, { error: "input_invalid" });
      return;
    }
    const result = await mapLocalSettingsError(() => settings.localSettings.setSuiGrpcUrl(urlValue));
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && matches.restoreDefaultSuiGrpcUrl) {
    await readJsonBody(request, MAX_SETTINGS_BODY_BYTES);
    const result = await mapLocalSettingsError(() => settings.localSettings.resetSuiGrpcUrl());
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && matches.setSuiGraphqlUrl) {
    const body = await readJsonBody(request, MAX_SETTINGS_BODY_BYTES);
    const urlValue = typeof body.url === "string" ? body.url : undefined;
    if (!urlValue) {
      sendJson(response, 400, { error: "input_invalid" });
      return;
    }
    const result = await mapLocalSettingsError(() => settings.localSettings.setSuiGraphqlUrl(urlValue));
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && matches.restoreDefaultSuiGraphqlUrl) {
    await readJsonBody(request, MAX_SETTINGS_BODY_BYTES);
    const result = await mapLocalSettingsError(() => settings.localSettings.resetSuiGraphqlUrl());
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "GET" && matches.exportLocalData) {
    const envelope = await mapLocalDataError(() => settings.localData.exportLocalData());
    sendJson(response, 200, envelope);
    return;
  }

  if (request.method === "POST" && matches.previewImport) {
    const body = await readJsonBody(request, MAX_IMPORT_BODY_BYTES);
    const preview = await mapLocalDataError(() => settings.localData.previewImportLocalData(body));
    sendJson(response, 200, preview);
    return;
  }

  if (request.method === "POST" && matches.importLocalData) {
    const body = await readJsonBody(request, MAX_IMPORT_BODY_BYTES);
    const result = await mapLocalDataError(() => settings.localData.importLocalDataReplace(body));
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && matches.resetLocalData) {
    await readJsonBody(request, MAX_SETTINGS_BODY_BYTES);
    const result = await mapLocalDataError(() => settings.localData.resetLocalData());
    sendJson(response, 200, result);
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

function requireSettingsDeps(options: SettingsApiRouteOptions): {
  activityStore: ActivityStore;
  localSettings: LocalSettingsService;
  localData: LocalDataService;
  serverInfo: { name: string; version: string; network: "mainnet" };
} {
  if (!options.activityStore || !options.localSettings || !options.localData || !options.serverInfo) {
    throw new HttpError(404, "not_found");
  }
  return {
    activityStore: options.activityStore,
    localSettings: options.localSettings,
    localData: options.localData,
    serverInfo: options.serverInfo
  };
}

async function mapLocalSettingsError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof LocalSettingsError) {
      throw new HttpError(statusForLocalSettingsError(error), error.kind);
    }
    throw error;
  }
}

function statusForLocalSettingsError(error: LocalSettingsError): number {
  return error.kind === "input_invalid" ? 400 : 500;
}

async function mapLocalDataError<T extends LocalDataImportPreview | LocalDataMutationResult | unknown>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof LocalDataError) {
      throw new HttpError(statusForLocalDataError(error), error.kind);
    }
    throw error;
  }
}

function statusForLocalDataError(error: LocalDataError): number {
  return error.kind === "input_invalid" ? 400 : 500;
}
