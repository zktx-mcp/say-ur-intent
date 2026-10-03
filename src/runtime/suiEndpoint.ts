import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
  MAX_SUI_GRAPHQL_URL_LENGTH,
  MAX_SUI_GRPC_URL_LENGTH,
  SuiEndpointError,
  parseGraphqlUrl,
  parseGrpcUrl
} from "../core/suiEndpoint.js";
export { MAX_SUI_GRAPHQL_URL_LENGTH, MAX_SUI_GRPC_URL_LENGTH, SuiEndpointError, parseGraphqlUrl, parseGrpcUrl };
export type { SuiEndpointErrorKind } from "../core/suiEndpoint.js";

export const SUI_MAINNET_CHAIN_IDENTIFIER = "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S";
export const DEFAULT_SUI_GRPC_URL = "https://fullnode.mainnet.sui.io:443";
export const DEFAULT_SUI_GRAPHQL_URL = "https://graphql.mainnet.sui.io/graphql";
export const DEFAULT_SUI_GRPC_ENDPOINT_VERIFY_TIMEOUT_MS = 10_000;
export const DEFAULT_SUI_GRAPHQL_ENDPOINT_VERIFY_TIMEOUT_MS = 10_000;

export type VerifyMainnetGrpcEndpointInput = {
  url: string;
  expectedChainIdentifier?: string | undefined;
  timeoutMs?: number | undefined;
};

export type VerifiedMainnetGrpcEndpoint = {
  client: SuiGrpcClient;
  chainIdentifier: string;
};

export type VerifyMainnetGraphqlEndpointInput = {
  url: string;
  expectedChainIdentifier?: string | undefined;
  timeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
};

export type VerifiedMainnetGraphqlEndpoint = {
  client: SuiGraphQLClient;
  chainIdentifier: string;
};

export async function verifyMainnetGrpcEndpoint(
  input: VerifyMainnetGrpcEndpointInput
): Promise<VerifiedMainnetGrpcEndpoint> {
  const url = parseGrpcUrl(input.url);
  const expectedChainIdentifier = input.expectedChainIdentifier ?? SUI_MAINNET_CHAIN_IDENTIFIER;
  const timeoutMs = input.timeoutMs ?? DEFAULT_SUI_GRPC_ENDPOINT_VERIFY_TIMEOUT_MS;
  const client = new SuiGrpcClient({
    baseUrl: url,
    network: "mainnet"
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const chainIdentifier = await Promise.race([
      client.core.getChainIdentifier().then((result) => result.chainIdentifier),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new SuiEndpointError(
              "endpoint_timeout",
              `Sui gRPC endpoint verification timed out after ${timeoutMs}ms`,
              { timeoutMs, url }
            )
          );
        }, timeoutMs);
      })
    ]);

    if (chainIdentifier !== expectedChainIdentifier) {
      throw new SuiEndpointError(
        "chain_identifier_mismatch",
        `Sui chain identifier mismatch: expected mainnet, got ${chainIdentifier}`,
        { expectedChainIdentifier, chainIdentifier, url }
      );
    }

    return { client, chainIdentifier };
  } catch (error) {
    if (error instanceof SuiEndpointError) {
      throw error;
    }
    throw new SuiEndpointError(
      "endpoint_unreachable",
      "Could not verify Sui mainnet gRPC endpoint",
      {
        error: error instanceof Error ? error.message : String(error),
        url
      }
    );
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function verifyMainnetGraphqlEndpoint(
  input: VerifyMainnetGraphqlEndpointInput
): Promise<VerifiedMainnetGraphqlEndpoint> {
  const url = parseGraphqlUrl(input.url);
  const expectedChainIdentifier = input.expectedChainIdentifier ?? SUI_MAINNET_CHAIN_IDENTIFIER;
  const timeoutMs = input.timeoutMs ?? DEFAULT_SUI_GRAPHQL_ENDPOINT_VERIFY_TIMEOUT_MS;
  const client = new SuiGraphQLClient({
    url,
    network: "mainnet",
    ...(input.fetch ? { fetch: input.fetch } : {})
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const chainIdentifier = await Promise.race([
      client.query<{ chainIdentifier: string }>({
        query: "query SuiMcpChainIdentifier { chainIdentifier }",
        variables: {}
      }).then((result) => {
        const value = result.data?.chainIdentifier;
        if (typeof value !== "string" || value.length === 0) {
          throw new SuiEndpointError("endpoint_unreachable", "Sui GraphQL endpoint did not return chainIdentifier", {
            url
          });
        }
        return value;
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new SuiEndpointError(
              "endpoint_timeout",
              `Sui GraphQL endpoint verification timed out after ${timeoutMs}ms`,
              { timeoutMs, url }
            )
          );
        }, timeoutMs);
      })
    ]);

    if (chainIdentifier !== expectedChainIdentifier) {
      throw new SuiEndpointError(
        "chain_identifier_mismatch",
        `Sui chain identifier mismatch: expected mainnet, got ${chainIdentifier}`,
        { expectedChainIdentifier, chainIdentifier, url }
      );
    }

    return { client, chainIdentifier };
  } catch (error) {
    if (error instanceof SuiEndpointError) {
      throw error;
    }
    throw new SuiEndpointError(
      "endpoint_unreachable",
      "Could not verify Sui mainnet GraphQL endpoint",
      {
        error: error instanceof Error ? error.message : String(error),
        url
      }
    );
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
