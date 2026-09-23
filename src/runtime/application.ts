import { randomUUID } from "node:crypto";
import { mainnetCoins } from "@mysten/deepbook-v3";
import { SqliteActivityStore } from "../core/activity/sqliteActivityStore.js";
import {
  createDeepbookSwapTransactionMaterialDigestProducer,
  createDeepbookSwapTransactionMaterialProducer
} from "../adapters/deepbook/deepbookTransactionMaterialProducer.js";
import { createDeepbookSwapHumanReadableReviewProducer } from "../adapters/deepbook/deepbookHumanReviewProducer.js";
import {
  createFlowxSwapTransactionMaterialDigestProducer,
  createFlowxSwapTransactionMaterialProducer
} from "../adapters/flowx/flowxSwapTransactionMaterialProducer.js";
import { createFlowxSwapHumanReadableReviewProducer } from "../adapters/flowx/flowxSwapHumanReviewProducer.js";
import { createFlowxSwapReviewQuoteSource } from "../core/read/flowxQuoteClient.js";
import { validateSupportedAdapterLifecycle } from "../adapters/adapterLifecycleValidators.js";
import { buildSupportedReviewAdapters } from "../adapters/reviewAdapters.js";
import { ADAPTER_PROMPT_SURFACES } from "../adapters/adapterPromptSurfaces.js";
import { TransactionActivityService } from "../core/activity/transactionActivityService.js";
import { createSuiReadService } from "../core/read/readService.js";
import { createTransactionObjectOwnershipProducer } from "../core/action/transactionObjectOwnershipProducer.js";
import { verifySuiChainReceipt } from "../core/action/suiChainReceiptVerifier.js";
import { readPublicChainReceipt } from "../core/action/suiChainReceiptReader.js";
import { createReviewTimeSimulationProducer } from "../core/action/reviewTimeSimulationEvidence.js";
import { producePtbVisualizationArtifact } from "../core/action/ptbVisualizationProducer.js";
import { LocalSessionStore } from "../core/session/sessionStore.js";
import { createMcpServer } from "../mcp/server.js";
import { SERVER_NAME, SERVER_NETWORK, SERVER_VERSION } from "../mcp/serverInfo.js";
import { createReviewRequestHandler } from "../review-server/server.js";
import { DEFAULT_SUI_GRAPHQL_URL, DEFAULT_SUI_GRPC_URL, composeRuntimeConfig, type BootConfig } from "./config.js";
import { DeepbookOfficialIndexerSource } from "../core/read/deepbookOfficialIndexerSource.js";
import { RuntimeLocalSettingsService } from "./localSettingsService.js";
import type { Logger } from "./logger.js";
import { verifyMainnetGraphqlEndpoint, verifyMainnetGrpcEndpoint } from "./suiEndpoint.js";
import { GraphqlSuiTransactionActivitySource } from "./suiTransactionGraphqlSource.js";

import type { CardStore } from "../core/session/cardSessionStore.js";
import { createReadCardStore } from "../mcp-ui/readCards.js";
import { createDeepbookUsdcChartService } from "../core/read/deepbookUsdcChartService.js";
import { RuntimeDataAccess } from "./shared/dataAccess.js";
import { createInternalMcpHandler } from "./shared/mcpHttp.js";
import type { SharedApplication } from "./shared/server.js";

export async function createRuntimeApplication(bootConfig: BootConfig, logger: Logger): Promise<SharedApplication> {
  const access = new RuntimeDataAccess();
  let activityStore: SqliteActivityStore | undefined;
  let cards: CardStore | undefined;
  let chart: ReturnType<typeof createDeepbookUsdcChartService> | undefined;
  try {
    const store = new SqliteActivityStore({
      databasePath: bootConfig.activityDatabasePath,
      guardDatabase: access.guardDatabase,
      validateAdapterLifecycle: validateSupportedAdapterLifecycle
    });
    activityStore = store;
    const preferencesRepository = store.createPreferencesRepository();
    await preferencesRepository.ensureDefaultLocalSettings({
      suiGrpcUrl: DEFAULT_SUI_GRPC_URL,
      suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL
    });
    const storedSuiGrpcUrl = await preferencesRepository.getSuiGrpcUrl();
    const storedSuiGraphqlUrl = await preferencesRepository.getSuiGraphqlUrl();
    const config = composeRuntimeConfig({
      bootConfig,
      env: process.env,
      storedSuiGrpcUrl: storedSuiGrpcUrl?.value,
      storedSuiGraphqlUrl: storedSuiGraphqlUrl?.value,
      defaultSuiGrpcUrl: DEFAULT_SUI_GRPC_URL,
      defaultSuiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL
    });
    const { client: suiClient, chainIdentifier } = await verifyMainnetGrpcEndpoint({
      url: config.grpcUrl,
      expectedChainIdentifier: config.expectedChainIdentifier
    });
    const localSettings = new RuntimeLocalSettingsService({
      preferencesRepository,
      env: process.env,
      defaultSuiGrpcUrl: DEFAULT_SUI_GRPC_URL,
      defaultSuiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL,
      bootSuiGrpcUrl: config.suiGrpcUrl,
      bootSuiGraphqlUrl: config.suiGraphqlUrl
    });
    const localData = store.createLocalDataService({
      onDataReplaced: () => { access.dataReplaced(); chart?.clearCache(); },
      suiGrpcUrl: DEFAULT_SUI_GRPC_URL,
      suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL,
      verifySuiGrpcUrl: async (url) => {
        await verifyMainnetGrpcEndpoint({
          url,
          expectedChainIdentifier: config.expectedChainIdentifier
        });
      },
      verifySuiGraphqlUrl: async (url) => {
        await verifyMainnetGraphqlEndpoint({
          url,
          expectedChainIdentifier: config.expectedChainIdentifier
        });
      }
    });
    const transactionMaterialStore = store.createTransactionMaterialStore();
    const sessions = new LocalSessionStore({
      activityStore: store,
      transactionMaterialStore,
      logger,
      validateAdapterLifecycle: validateSupportedAdapterLifecycle,
      sessions: store.createSessionRecordStore(),
      artifacts: store.createPrivateReviewArtifactStore(),
      walletIdentityStore: store.createWalletIdentityRecordStore(),
      settingsStore: store.createSettingsRecordStore()
    });
    const readService = createSuiReadService({
      client: suiClient,
      network: config.network,
      chainIdentifier,
      coinMetadataCache: store.createCoinMetadataCache(),
      deepbookOfficialIndexerSource: new DeepbookOfficialIndexerSource()
    });
    const chainReceiptVerifier = (input: Parameters<typeof verifySuiChainReceipt>[1]) =>
      verifySuiChainReceipt(
        {
          client: suiClient,
          network: config.network,
          expectedChainIdentifier: config.expectedChainIdentifier
        },
        input
      );
    const publicChainReceiptReader = (input: Parameters<typeof readPublicChainReceipt>[1]) =>
      readPublicChainReceipt(
        {
          client: suiClient,
          network: config.network,
          expectedChainIdentifier: config.expectedChainIdentifier,
          resolveCoinUnit: (coinType) => readService.resolveCoinUnit(coinType)
        },
        input
      );
    const httpHandler = createReviewRequestHandler({
      host: config.reviewHost,
      store: sessions,
      logger,
      activityStore: store,
      localSettings,
      localData,
      chainReceiptVerifier,
      publicChainReceiptReader,
      reviewComputationDeps: {
        validateAdapterLifecycle: validateSupportedAdapterLifecycle,
        adapters: buildSupportedReviewAdapters((() => {
          const transactionObjectOwnershipProducer = createTransactionObjectOwnershipProducer({
            materialStore: transactionMaterialStore,
            objectSource: suiClient,
            network: config.network,
            chainIdentifier,
            expectedChainIdentifier: config.expectedChainIdentifier
          });
          const reviewTimeSimulationProducer = createReviewTimeSimulationProducer({
            client: suiClient,
            materialStore: transactionMaterialStore,
            network: config.network,
            chainIdentifier,
            expectedChainIdentifier: config.expectedChainIdentifier
          });
          return {
            deepbook: {
              deepbookQuoteSource: readService,
              deepbookDeepBalanceSource: async (account: string) => {
                const balance = await suiClient.core.getBalance({
                  owner: account,
                  coinType: mainnetCoins.DEEP!.type
                });
                return balance.balance.balance.toString();
              },
              deepbookTransactionMaterialProducer: createDeepbookSwapTransactionMaterialProducer({
                client: suiClient,
                network: config.network,
                chainIdentifier,
                expectedChainIdentifier: config.expectedChainIdentifier,
                materialStore: transactionMaterialStore
              }),
              deepbookTransactionMaterialDigestProducer: createDeepbookSwapTransactionMaterialDigestProducer({
                materialStore: transactionMaterialStore
              }),
              transactionObjectOwnershipProducer,
              deepbookHumanReadableReviewProducer: createDeepbookSwapHumanReadableReviewProducer(),
              reviewTimeSimulationProducer,
              ptbVisualizationProducer: (vizInput) =>
                producePtbVisualizationArtifact({ materialStore: transactionMaterialStore, ...vizInput })
            },
            flowx: {
              flowxQuoteSource: createFlowxSwapReviewQuoteSource(),
              flowxTransactionMaterialProducer: createFlowxSwapTransactionMaterialProducer({
                client: suiClient,
                network: config.network,
                chainIdentifier,
                expectedChainIdentifier: config.expectedChainIdentifier,
                materialStore: transactionMaterialStore
              }),
              flowxTransactionMaterialDigestProducer: createFlowxSwapTransactionMaterialDigestProducer({
                materialStore: transactionMaterialStore
              }),
              transactionObjectOwnershipProducer,
              flowxHumanReadableReviewProducer: createFlowxSwapHumanReadableReviewProducer(),
              reviewTimeSimulationProducer,
              ptbVisualizationProducer: (vizInput) =>
                producePtbVisualizationArtifact({ materialStore: transactionMaterialStore, ...vizInput })
            }
          };
        })())
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        network: SERVER_NETWORK
      }
    });

    chart = createDeepbookUsdcChartService({ assertCurrent: access.assertCurrent });
    cards = createReadCardStore({ readService, publicChainReceiptReader, chart, records: store.createCardRecordStore(), ownerId: randomUUID(), assertCurrent: access.assertCurrent, logger });
    const transactionActivityService = new TransactionActivityService({
        activityStore: store,
        source: new GraphqlSuiTransactionActivitySource({
          url: config.graphqlUrl,
          expectedChainIdentifier: config.expectedChainIdentifier
        })
      });
    const mcp = createInternalMcpHandler(() => createMcpServer({
      cards: { store: cards! },
      promptSurfaces: ADAPTER_PROMPT_SURFACES,
      sessions,
      activityStore: store,
      reviewBaseUrl: `http://${config.reviewHost}:${config.reviewPort}`,
      readService,
      transactionActivityService,
      chainReceiptVerifier,
      localSettings,
      logger
    }));

    access.ready();
    return {
      handleMcp: (request, response) => access.run(() => mcp.handle(request, response)),
      handleHttp: (request, response) => access.run(() => httpHandler(request, response)),
      async close() {
        access.close(); cards?.stop(); chart?.clearCache();
        try { await mcp.close(); } finally { store.close(); }
      }
    };
  } catch (error) {
    access.close(); cards?.stop();
    activityStore?.close();
    throw error;
  }
}
