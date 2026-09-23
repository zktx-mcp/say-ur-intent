import type { SuiClientTypes } from "@mysten/sui/client";
import {
  DEEPBOOK_SCALAR_UNIT_SOURCE,
  DISPLAY_AMOUNT_SOURCE,
  SUI_METADATA_UNIT_SOURCE,
  formatRawAmount,
  normalizeCoinType,
  type CoinMetadataCacheRecord,
  type CoinUnit,
  type UnitCacheStatus,
  type UnitUnavailableReason,
  type WalletBalanceWithUnit
} from "./coinMetadata.js";
import { findDeepbookCoinEntry } from "./deepbookRegistry.js";
import type {
  ClassifiedWalletAsset,
  DeepBookCoinRegistry,
  WalletBalanceQuantitySemantics,
  WalletAssetClassificationRole
} from "./readServiceTypes.js";
import { WALLET_BALANCE_QUANTITY_KIND } from "./readServiceTypes.js";

export const SUI_COIN_TYPE = normalizeCoinType("0x2::sui::SUI");

export function walletBalanceQuantitySemantics(): WalletBalanceQuantitySemantics {
  return {
    kind: WALLET_BALANCE_QUANTITY_KIND,
    allowedUse: "current_coin_balance_snapshot",
    currentBalanceSnapshot: true,
    transactionHistoryAvailable: false,
    transactionReceiptProofAvailable: false,
    transactionBalanceDeltaAvailable: false,
    acquisitionSourceAvailable: false,
    objectProvenanceAvailable: false,
    fiatUsdCashOutAvailable: false,
    profitAndLossAvailable: false,
    costBasisAvailable: false,
    notFor: [
      "transaction_history",
      "transaction_receipt_proof",
      "specific_transaction_balance_delta",
      "acquisition_source",
      "object_provenance",
      "fiat_usd_cash_out",
      "profit_or_pnl",
      "cost_basis",
      "signing_data"
    ]
  };
}

export function classifyWalletBalance(
  balance: WalletBalanceWithUnit,
  coins: DeepBookCoinRegistry
): ClassifiedWalletAsset {
  const roles: WalletAssetClassificationRole[] = [];
  let normalizedCoinType: string | undefined;
  try {
    normalizedCoinType = normalizeCoinType(balance.coinType);
  } catch {
    normalizedCoinType = undefined;
  }

  if (normalizedCoinType === SUI_COIN_TYPE) {
    roles.push("gas_candidate");
  }
  if (normalizedCoinType && findDeepbookCoinEntry(normalizedCoinType, coins)) {
    roles.push("deepbook_registered");
  }

  return {
    balance,
    classification: {
      assetClass: "coin_balance",
      balanceStatus: balance.balance === "0" ? "zero" : "nonzero",
      roles
    }
  };
}

export function unitFromMetadataRecord(record: CoinMetadataCacheRecord, cacheStatus: UnitCacheStatus): CoinUnit {
  return {
    status: "available",
    source: SUI_METADATA_UNIT_SOURCE,
    decimals: record.decimals,
    symbol: record.symbol,
    name: record.name,
    cacheStatus
  };
}

export function unitFromDeepbook(unit: { decimals: number; symbol: string; name: string }): CoinUnit {
  return {
    status: "available",
    source: DEEPBOOK_SCALAR_UNIT_SOURCE,
    decimals: unit.decimals,
    symbol: unit.symbol,
    name: unit.name
  };
}

export function withUnavailableUnit(
  balance: SuiClientTypes.Balance,
  reason: UnitUnavailableReason
): WalletBalanceWithUnit {
  return withResolvedUnit(balance, unavailableUnit(reason));
}

export function unavailableUnit(reason: UnitUnavailableReason): CoinUnit {
  return {
    status: "unavailable",
    reason
  };
}

export function withResolvedUnit(balance: SuiClientTypes.Balance, unit: CoinUnit): WalletBalanceWithUnit {
  if (unit.status === "unavailable") {
    return {
      ...balance,
      unit
    };
  }
  return {
    ...balance,
    unit,
    display: {
      amount: formatRawAmount(balance.balance, unit.decimals),
      symbol: unit.symbol,
      source: DISPLAY_AMOUNT_SOURCE
    }
  };
}
