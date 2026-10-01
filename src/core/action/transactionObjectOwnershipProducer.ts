import { describeTransactionFunding, readTransactionFunding, TransactionFundingError, type TransactionFundingSource, type TransactionFundingEvidence } from "./transactionFunding.js";
import { Transaction } from "@mysten/sui/transactions";
import type { BlockedReason, RefreshReason, ReviewCheck } from "./types.js";
import {
  mapTransactionObjectOwnershipEvidenceToContractDraft,
  parseTransactionObjectOwnershipEvidence,
  TRANSACTION_OBJECT_OWNERSHIP_EVIDENCE_VERSION,
  type TransactionObjectOwnership,
  type TransactionObjectOwnershipEvidence,
  type TransactionObjectOwnershipFact,
  type TransactionObjectRole
} from "./transactionObjectOwnershipEvidence.js";
import {
  failReviewCheck,
  passReviewCheck
} from "./reviewCheckResults.js";
import { parseSuiAddress } from "../suiAddress.js";
import {
  LocalTransactionMaterialStoreError,
  verifyLocalTransactionMaterialArtifacts,
  type LocalTransactionMaterialDigestCommitment,
  type LocalTransactionMaterialHandle,
  type LocalTransactionMaterialStore
} from "../session/transactionMaterialStore.js";

export type TransactionObjectOwnershipProducerInput = {
  materialHandle: LocalTransactionMaterialHandle;
  materialDigest: LocalTransactionMaterialDigestCommitment;
  now: Date;
};

export type TransactionObjectOwnershipProducerOutcome =
  | {
      status: "completed";
      evidence: TransactionObjectOwnershipEvidence;
      checks: ReviewCheck[];
    }
  | {
      status: "blocked";
      blockedReason: BlockedReason;
      checks: [ReviewCheck, ...ReviewCheck[]];
    }
  | {
      status: "refresh_required";
      refreshReason: RefreshReason;
      checks: [ReviewCheck, ...ReviewCheck[]];
    };

export type TransactionObjectOwnershipProducer = (
  input: TransactionObjectOwnershipProducerInput
) => TransactionObjectOwnershipProducerOutcome | Promise<TransactionObjectOwnershipProducerOutcome>;

export type TransactionObjectOwnershipProducerOptions = {
  materialStore: Pick<LocalTransactionMaterialStore, "getTransactionMaterial">;
  objectSource: TransactionObjectOwnershipObjectSource;
  fundingSource?: TransactionFundingSource;
  network: "mainnet";
  chainIdentifier: string;
  expectedChainIdentifier: string;
};

export type TransactionObjectOwnershipObjectSource = {
  getObject(input: {
    objectId: string;
  }): Promise<{
    object: {
      objectId: string;
      owner: SuiObjectOwnerLike;
      type: string;
    };
  }>;
};

type SuiObjectOwnerLike =
  | { $kind: "AddressOwner"; AddressOwner: string }
  | { $kind: "ObjectOwner"; ObjectOwner: string }
  | { $kind: "Shared"; Shared: { initialSharedVersion: string } }
  | { $kind: "Immutable"; Immutable: true }
  | { $kind: "ConsensusAddressOwner"; ConsensusAddressOwner: { startVersion: string; owner: string } }
  | { $kind: "Unknown" }
  | Record<string, unknown>;

type ExtractedObjectRef = {
  objectId: string;
  role: TransactionObjectRole;
};

export function createTransactionObjectOwnershipProducer(
  options: TransactionObjectOwnershipProducerOptions
): TransactionObjectOwnershipProducer {
  return async (input) => {
    if (options.network !== "mainnet" || options.chainIdentifier !== options.expectedChainIdentifier) {
      return {
        status: "blocked",
        blockedReason: "network_mismatch",
        checks: [
          failReviewCheck(
            "transaction_object_ownership_network_mismatch",
            "Object ownership network",
            "Object ownership evidence requires a verified Sui mainnet object source and matching mainnet chain identifier.",
            "network"
          )
        ]
      };
    }

    let materialHandle: LocalTransactionMaterialHandle;
    let materialDigest: LocalTransactionMaterialDigestCommitment;
    try {
      const verified = await verifyLocalTransactionMaterialArtifacts({
        materialStore: options.materialStore,
        transactionMaterial: input.materialHandle,
        transactionMaterialDigest: input.materialDigest,
        now: input.now
      });
      materialHandle = verified.transactionMaterial;
      materialDigest = verified.transactionMaterialDigest;
    } catch (error) {
      const message = error instanceof Error ? error.message : "transaction material is unavailable";
      const check = failReviewCheck(
        "transaction_object_ownership_material_unavailable",
        "Object ownership material",
        "Object ownership evidence was not produced because the stored local transaction material was unavailable, stale, or not bound to its internal digest.",
        "adapter"
      );
      if (message.includes("expired") || message.includes("unavailable")) {
        return {
          status: "refresh_required",
          refreshReason: "quote_stale",
          checks: [check]
        };
      }
      return {
        status: "blocked",
        blockedReason: "object_resolution_failed",
        checks: [check]
      };
    }

    const material = options.materialStore.getTransactionMaterial(materialHandle, input.now);
    if (!material) {
      return {
        status: "refresh_required",
        refreshReason: "quote_stale",
        checks: [
          failReviewCheck(
            "transaction_object_ownership_material_unavailable",
            "Object ownership material",
            "Object ownership evidence was not produced because the stored local transaction material was unavailable or expired; refresh the review evidence before continuing.",
            "adapter"
          )
        ]
      };
    }

    let objectRefs: ExtractedObjectRef[];
    let funding: TransactionFundingEvidence;
    try {
      const description = describeTransactionFunding(Transaction.from(material.transactionBytes).getData(), materialHandle.account, options.chainIdentifier);
      funding = await readTransactionFunding(description, options.fundingSource);
      objectRefs = extractObjectRefsFromStoredTransactionBytes(material.transactionBytes, funding.gasObjectIds);
    } catch (error) {
      if (error instanceof TransactionFundingError) return { status: "blocked",
        blockedReason: error.kind === "insufficient_balance" || error.kind === "insufficient_gas" ? error.kind : "object_resolution_failed",
        checks: [failReviewCheck("transaction_funding_" + error.kind, "Transaction funding", error.message, error.kind === "unavailable" ? "network" : "wallet")] };
      return {
        status: "blocked",
        blockedReason: "object_resolution_failed",
        checks: [
          failReviewCheck(
            "transaction_object_ownership_refs_unavailable",
            "Object ownership refs",
            "Transaction funding and object ownership could not be verified because the stored material has invalid or unsupported account, gas, withdrawal, expiration or object references.",
            "adapter"
          )
        ]
      };
    }

    const objectRoles = mergeObjectRoles(objectRefs);
    if (objectRoles.size === 0) {
      return {
        status: "blocked",
        blockedReason: "object_resolution_failed",
        checks: [
          failReviewCheck(
            "transaction_object_ownership_refs_empty",
            "Object ownership refs",
            "Object ownership evidence requires at least one resolved transaction object reference.",
            "adapter"
          )
        ]
      };
    }
    const facts: TransactionObjectOwnershipFact[] = [];
    for (const [objectId, roles] of objectRoles) {
      let response: Awaited<ReturnType<TransactionObjectOwnershipObjectSource["getObject"]>>;
      try {
        response = await options.objectSource.getObject({ objectId });
      } catch {
        return objectReadBlocked();
      }
      if (parseSuiObjectId(response.object.objectId) !== objectId) {
        return objectReadBlocked();
      }
      const fact = classifyObjectOwnership({
        objectId,
        roles,
        owner: response.object.owner,
        objectType: response.object.type,
        account: materialHandle.account
      });
      if (!fact) {
        return objectReadBlocked();
      }
      facts.push(fact);
    }

    const invalidFact = facts.find((fact) => !isAcceptableOwnershipFact(fact));
    if (invalidFact) {
      const blockedReason: BlockedReason = "object_resolution_failed";
      return {
        status: "blocked",
        blockedReason,
        checks: [
          failReviewCheck(
            "transaction_object_ownership_unverified",
            "Object ownership",
            "An object's ownership could not be confirmed, or an account-owned transaction or gas object belongs to a different account.",
            invalidFact.roles.includes("gas_object") ? "wallet" : "adapter"
          )
        ]
      };
    }

    let evidence: TransactionObjectOwnershipEvidence;
    try {
      evidence = parseTransactionObjectOwnershipEvidence({
        evidenceVersion: TRANSACTION_OBJECT_OWNERSHIP_EVIDENCE_VERSION,
        materialId: materialHandle.materialId,
        reviewSessionId: materialHandle.reviewSessionId,
        planId: materialHandle.planId,
        account: materialHandle.account,
        transactionDigest: materialDigest.transactionDigest,
        funding,
        objectCount: facts.length,
        objects: facts,
        verifiedAt: input.now.toISOString(),
        expiresAt: materialHandle.expiresAt
      });
    } catch {
      return objectReadBlocked();
    }
    const contractMapping = mapTransactionObjectOwnershipEvidenceToContractDraft(evidence);
    if (contractMapping.status === "unsupported") {
      return {
        status: "blocked",
        blockedReason: "object_resolution_failed",
        checks: [
          failReviewCheck(
            "transaction_object_ownership_contract_mapping_unsupported",
            "Object ownership contract mapping",
            `The object ownership checks could not be used for this transaction review. Reported reason: “${contractMapping.reason}”.`,
            contractMapping.roles.includes("gas_object") ? "wallet" : "adapter"
          )
        ]
      };
    }

    return {
      status: "completed",
      evidence,
      checks: [
        passReviewCheck(
          "transaction_object_ownership_verified",
          "Object ownership",
          "Checked the transaction objects against Sui mainnet. The gas objects and account-owned coins belong to the connected account; shared or immutable protocol objects are recorded separately. These ownership checks do not authorize wallet approval or guarantee execution.",
          "wallet"
        )
      ]
    };
  };
}

function extractObjectRefsFromStoredTransactionBytes(transactionBytes: Uint8Array, gasObjectIds: readonly string[]): ExtractedObjectRef[] {
  const transaction = Transaction.from(transactionBytes);
  const data = transaction.getData();
  const refs: ExtractedObjectRef[] = [];

  for (const objectId of gasObjectIds) refs.push({ objectId, role: "gas_object" });

  for (const input of data.inputs) {
    const inputKind = enumKind(input, [
      "Object",
      "Pure",
      "UnresolvedPure",
      "UnresolvedObject",
      "FundsWithdrawal"
    ]);
    if (!inputKind) {
      throw new LocalTransactionMaterialStoreError("unknown transaction input kind");
    }
    if (inputKind === "Pure" || inputKind === "UnresolvedPure" || inputKind === "FundsWithdrawal") {
      continue;
    }
    if (inputKind === "UnresolvedObject") {
      throw new LocalTransactionMaterialStoreError("transaction object refs must be resolved");
    }

    const objectInput = (input as { Object?: unknown }).Object;
    const objectKind = enumKind(objectInput, [
      "ImmOrOwnedObject",
      "SharedObject",
      "Receiving"
    ]);
    if (!objectKind) {
      throw new LocalTransactionMaterialStoreError("unknown transaction object input kind");
    }

    if (objectKind === "ImmOrOwnedObject") {
      refs.push({
        objectId: readObjectId((objectInput as { ImmOrOwnedObject?: unknown }).ImmOrOwnedObject),
        role: "imm_or_owned_object"
      });
    } else if (objectKind === "SharedObject") {
      refs.push({
        objectId: readObjectId((objectInput as { SharedObject?: unknown }).SharedObject),
        role: "shared_object"
      });
    } else {
      refs.push({
        objectId: readObjectId((objectInput as { Receiving?: unknown }).Receiving),
        role: "receiving_object"
      });
    }
  }

  return refs;
}

function enumKind(value: unknown, allowedKinds: readonly string[]): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if ("$kind" in value) {
    return typeof value.$kind === "string" && allowedKinds.includes(value.$kind)
      ? value.$kind
      : undefined;
  }
  const matchingKeys = allowedKinds.filter((kind) => kind in value);
  return matchingKeys.length === 1 ? matchingKeys[0] : undefined;
}

function readObjectId(value: unknown): string {
  if (!isRecord(value) || typeof value.objectId !== "string") {
    throw new LocalTransactionMaterialStoreError("transaction object ref is missing objectId");
  }
  return parseSuiObjectId(value.objectId);
}

function parseSuiObjectId(value: string): string {
  const objectId = parseSuiAddress(value);
  if (!objectId) {
    throw new LocalTransactionMaterialStoreError("transaction object ref has invalid Sui object id");
  }
  return objectId;
}

function mergeObjectRoles(refs: ExtractedObjectRef[]): Map<string, TransactionObjectRole[]> {
  const merged = new Map<string, TransactionObjectRole[]>();
  for (const ref of refs) {
    const roles = merged.get(ref.objectId) ?? [];
    if (!roles.includes(ref.role)) {
      roles.push(ref.role);
    }
    merged.set(ref.objectId, roles);
  }
  return merged;
}

function classifyObjectOwnership(input: {
  objectId: string;
  roles: TransactionObjectRole[];
  owner: SuiObjectOwnerLike;
  objectType: string;
  account: string;
}): TransactionObjectOwnershipFact | undefined {
  if (!isRecord(input.owner) || typeof input.owner.$kind !== "string") {
    return undefined;
  }
  if (typeof input.objectType !== "string") {
    return undefined;
  }

  if (input.owner.$kind === "AddressOwner") {
    const ownerAccount = parseSuiAddress(
      typeof input.owner.AddressOwner === "string" ? input.owner.AddressOwner : ""
    );
    if (!ownerAccount) {
      return undefined;
    }
    return {
      objectId: input.objectId,
      roles: input.roles,
      ownership: ownerAccount === input.account ? "owned_by_account" : "not_owned_by_account",
      ownerKind: "AddressOwner",
      ownerAccount,
      objectType: input.objectType,
      source: "stored_transaction_data_and_mainnet_object_read"
    };
  }

  if (input.owner.$kind === "Shared") {
    return ownershipFact(input, "shared_object", "Shared");
  }

  if (input.owner.$kind === "Immutable") {
    return ownershipFact(input, "immutable_object", "Immutable");
  }

  if (input.owner.$kind === "ObjectOwner") {
    return ownershipFact(input, "object_owner", "ObjectOwner");
  }

  if (input.owner.$kind === "ConsensusAddressOwner") {
    return ownershipFact(input, "consensus_address_owner", "ConsensusAddressOwner");
  }

  if (input.owner.$kind === "Unknown") {
    return ownershipFact(input, "unknown_owner", "Unknown");
  }

  return undefined;
}

function ownershipFact(
  input: {
    objectId: string;
    roles: TransactionObjectRole[];
    objectType: string;
  },
  ownership: TransactionObjectOwnership,
  ownerKind: string
): TransactionObjectOwnershipFact {
  return {
    objectId: input.objectId,
    roles: input.roles,
    ownership,
    ownerKind,
    objectType: input.objectType,
    source: "stored_transaction_data_and_mainnet_object_read"
  };
}

function isAcceptableOwnershipFact(fact: TransactionObjectOwnershipFact): boolean {
  if (fact.ownership === "unknown_owner" || fact.ownership === "object_owner" || fact.ownership === "consensus_address_owner") {
    return false;
  }
  if (fact.roles.includes("gas_object")) {
    return fact.ownership === "owned_by_account";
  }
  if (fact.roles.includes("imm_or_owned_object") || fact.roles.includes("receiving_object")) {
    return fact.ownership === "owned_by_account" ||
      (fact.roles.includes("imm_or_owned_object") && fact.ownership === "immutable_object");
  }
  return fact.roles.every((role) => role === "shared_object")
    ? fact.ownership === "shared_object" || fact.ownership === "immutable_object"
    : false;
}

function objectReadBlocked(): TransactionObjectOwnershipProducerOutcome {
  return {
    status: "blocked",
    blockedReason: "object_resolution_failed",
    checks: [
      failReviewCheck(
        "transaction_object_ownership_read_failed",
        "Object ownership read",
        "Object ownership evidence was not produced because a transaction object owner could not be read or classified from mainnet object state.",
        "network"
      )
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
