import { mainnetCoins } from "@mysten/deepbook-v3";
import { buildSupportedReviewAdapters } from "../adapters/reviewAdapters.js";
import { validateSupportedAdapterLifecycle } from "../adapters/adapterLifecycleValidators.js";
import { createDeepbookSwapTransactionMaterialDigestProducer, createDeepbookSwapTransactionMaterialProducer } from "../adapters/deepbook/deepbookTransactionMaterialProducer.js";
import { createDeepbookSwapHumanReadableReviewProducer } from "../adapters/deepbook/deepbookHumanReviewProducer.js";
import { createTransactionObjectOwnershipProducer } from "../core/action/transactionObjectOwnershipProducer.js";
import { createReviewTimeSimulationProducer } from "../core/action/reviewTimeSimulationEvidence.js";
import { producePtbVisualizationArtifact } from "../core/action/ptbVisualizationProducer.js";
import type { ReviewComputationDeps } from "../core/review/reviewComputation.js";
import type { LocalTransactionMaterialStore } from "../core/session/transactionMaterialStore.js";
import type { SuiReadService } from "../core/read/readService.js";
import type { verifyMainnetGrpcEndpoint } from "./suiEndpoint.js";

export function createRuntimeReviewDependencies(options: {
  client: Awaited<ReturnType<typeof verifyMainnetGrpcEndpoint>>["client"];
  chainIdentifier: string; expectedChainIdentifier: string;
  materialStore: LocalTransactionMaterialStore; readService: SuiReadService;
}): ReviewComputationDeps {
  const { client: suiClient, chainIdentifier, materialStore: transactionMaterialStore, readService } = options;
  const config = { network: "mainnet" as const, expectedChainIdentifier: options.expectedChainIdentifier };
  return {
        validateAdapterLifecycle: validateSupportedAdapterLifecycle,
        adapters: buildSupportedReviewAdapters((() => {
          const transactionObjectOwnershipProducer = createTransactionObjectOwnershipProducer({
            materialStore: transactionMaterialStore,
            objectSource: suiClient,
            fundingSource: suiClient.core,
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
            }
          };
        })())
      };
}
