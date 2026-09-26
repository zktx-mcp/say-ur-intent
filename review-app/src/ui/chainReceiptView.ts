// Shared on-chain receipt view: the verified facts for one transaction digest,
// composed from shared atoms. Both the internal Receipt card and the
// review page's post-sign Result state render this same component from the same
// `PublicChainReceipt`, so a confirmed transaction looks identical wherever it is
// shown. It renders the display only — the page owns its own surrounding chrome,
// and the loading/error states.

import type {
  PublicChainReceipt,
  PublicChainReceiptBalanceChange,
  PublicChainReceiptEvent,
  PublicChainReceiptGas,
  PublicChainReceiptInput
} from "../../../src/core/action/suiChainReceiptReader.js";
import type { SuiChainReceiptPackageCall } from "../../../src/core/action/suiChainReceiptEvidence.js";
import { accordion, card, detailItem, element, info, mono, note, placeholder, row, statusBanner } from "./ui.js";
import { ptbGraphCard } from "./ptbDiagram.js";
import { qualifiedName, shortHex, shortType, signedRawToDisplay, suiAmount, typeName } from "../format.js";
import { t } from "../i18n/i18n.js";

// Receipt layout: observed outcome → balance changes (in decimals)
// → gas → PTB graph (the left-to-right centerpiece, placeholder when none) →
// collapsed accordions (inputs, Move calls, object changes, events).
export function chainReceiptView(receipt: PublicChainReceipt): HTMLElement {
  const wrap = element("div", "ui-chain-receipt");
  const success = receipt.effectsStatus.success;

  // Card — overview: independent chain outcome and its observation context.
  const overview = card(t.receipt.facts);
  overview.append(statusBanner(success ? "success" : "failure", success ? t.receipt.success : t.receipt.failure));
  if (!success && receipt.effectsStatus.errorMessage) {
    overview.append(row(t.receipt.error, receipt.effectsStatus.errorMessage));
  }
  if (receipt.sender) {
    overview.append(row(t.receipt.sender, monoShort(receipt.sender)));
  }
  overview.append(row(t.receipt.checkedAt, receipt.fetchedAt));
  wrap.append(overview);

  // Card — balance changes (signed, in decimals when resolved, up/down tinted).
  const balances = card(t.receipt.balanceChanges);
  if (receipt.balanceChanges.length === 0) {
    balances.append(placeholder(t.receipt.noBalanceChanges));
  } else {
    for (const change of receipt.balanceChanges) {
      balances.append(balanceChangeItem(change, receipt.sender));
    }
  }
  wrap.append(balances);

  // Card — gas (always SUI, known decimals).
  const gasCard = card(t.receipt.gas);
  gasCard.append(gasSection(receipt.gas));
  wrap.append(gasCard);

  // The shared Transaction graph card (name/address toggle); a
  // placeholder card holds the same slot when the transaction has no renderable graph.
  if (receipt.ptbGraph) {
    wrap.append(
      ptbGraphCard({ source: "receipt", mermaid: receipt.ptbGraph.mermaid })
    );
  } else {
    const graphCard = infoTitleCard(t.receipt.graph, t.receipt.graphTip);
    graphCard.append(placeholder(t.receipt.noGraph));
    wrap.append(graphCard);
  }

  // Card — the detailed on-chain records (inputs, Move calls, object changes, events) grouped as
  // nested sliding lists under one titled card with a short note, so the technical breakdown sits
  // together rather than as four loose top-level disclosures. Being nested, the lists pick up the
  // square-corner treatment (rounded card, square inner lists).
  const records = card(t.receipt.records);
  records.append(row(t.receipt.digest, mono(receipt.txDigest)), note(t.receipt.recordsTip));
  records.append(inputsAccordion(receipt.inputs));
  records.append(moveCallsAccordion(receipt.packageCalls));
  records.append(objectChangesAccordion(receipt.objectTypes));
  records.append(eventsAccordion(receipt.events));
  wrap.append(records);

  return wrap;
}

// A card whose title carries an info tooltip (the graph note).
function infoTitleCard(titleText: string, tip: string): HTMLElement {
  const node = card();
  const head = element("h2", "ui-card-head");
  head.append(`${titleText} `, info(tip));
  node.append(head);
  return node;
}

function balanceChangeItem(change: PublicChainReceiptBalanceChange, sender: string | undefined): HTMLElement {
  const symbol = change.symbol ?? typeName(change.coinType);
  // The raw amount already carries the sign for a decrease; an increase gets an
  // explicit "+" so direction reads at a glance (with the up/down tint below).
  const magnitude =
    change.decimals !== undefined ? signedRawToDisplay(change.amountRaw, change.decimals) : change.amountRaw;
  const amount = change.direction === "increase" ? `+${magnitude}` : magnitude;
  const metas: Array<{ label?: string; value: string; full?: string }> = [
    { value: shortType(change.coinType), full: change.coinType }
  ];
  if (change.address !== sender) {
    metas.push({ label: t.receipt.account, value: shortHex(change.address), full: change.address });
  }
  return change.direction === "zero"
    ? detailItem({ title: symbol, trailing: amount, metas })
    : detailItem({ title: symbol, trailing: amount, trailingTone: change.direction === "increase" ? "up" : "down", metas });
}

// Shared gas-cost rows (Total fee / Computation / Storage / Storage rebate) for the receipt
// gas section and the review's Transaction details, so the labels and the "<n> SUI" idiom
// live in one place. Callers pass pre-named mist values: the receipt uses its
// PublicChainReceiptGas fields; the review passes its simulation net total + components.
export function gasRows(gas: {
  totalMist: string;
  computationMist: string;
  storageMist: string;
  storageRebateMist: string;
}): HTMLElement[] {
  return [
    row(t.receipt.gasTotal, suiAmount(gas.totalMist)),
    row(t.receipt.gasComputation, suiAmount(gas.computationMist)),
    row(t.receipt.gasStorage, suiAmount(gas.storageMist)),
    row(t.receipt.gasRebate, suiAmount(gas.storageRebateMist))
  ];
}

function gasSection(gas: PublicChainReceiptGas): HTMLElement {
  const wrap = element("div", "ui-chain-receipt-gas");
  for (const gasRow of gasRows(gas)) {
    wrap.append(gasRow);
  }
  if (gas.budgetMist !== undefined) {
    wrap.append(row(t.receipt.gasBudget, suiAmount(gas.budgetMist)));
  }
  if (gas.priceMist !== undefined) {
    wrap.append(row(t.receipt.gasPrice, `${gas.priceMist} MIST`));
  }
  if (gas.paymentObjectId !== undefined) {
    wrap.append(row(t.receipt.gasPayment, monoShort(gas.paymentObjectId)));
  }
  return wrap;
}

function inputsAccordion(inputs: PublicChainReceiptInput[]): HTMLElement {
  const { details, body } = accordion(`${t.receipt.inputs} (${inputs.length})`);
  if (inputs.length === 0) {
    body.append(placeholder(t.receipt.noInputs));
  } else {
    for (const inputEntry of inputs) {
      const metas: Array<{ label?: string; value: string; full?: string }> = [];
      if (inputEntry.objectId) {
        metas.push({ value: shortHex(inputEntry.objectId), full: inputEntry.objectId });
      }
      if (inputEntry.bytes) {
        metas.push({ label: t.receipt.bytes, value: shortHex(inputEntry.bytes), full: inputEntry.bytes });
      }
      body.append(detailItem({ title: t.receipt.inputKinds[inputEntry.kind], metas }));
    }
  }
  return details;
}

function moveCallsAccordion(calls: SuiChainReceiptPackageCall[]): HTMLElement {
  const { details, body } = accordion(`${t.receipt.moveCalls} (${calls.length})`);
  if (calls.length === 0) {
    body.append(placeholder(t.receipt.noMoveCalls));
  } else {
    for (const call of calls) {
      body.append(
        detailItem({ title: qualifiedName(call.target), metas: [{ value: shortType(call.target), full: call.target }] })
      );
    }
  }
  return details;
}

function objectChangesAccordion(objectTypes: Record<string, string>): HTMLElement {
  const entries = Object.entries(objectTypes);
  const { details, body } = accordion(`${t.receipt.objectChanges} (${entries.length})`);
  if (entries.length === 0) {
    body.append(placeholder(t.receipt.noObjectChanges));
  } else {
    for (const [objectId, objectType] of entries) {
      body.append(
        detailItem({
          title: typeName(objectType),
          metas: [
            { label: t.receipt.object, value: shortHex(objectId), full: objectId },
            { value: shortType(objectType), full: objectType }
          ]
        })
      );
    }
  }
  return details;
}

function eventsAccordion(events: PublicChainReceiptEvent[]): HTMLElement {
  const { details, body } = accordion(`${t.receipt.events} (${events.length})`);
  if (events.length === 0) {
    body.append(placeholder(t.receipt.noEvents));
  } else {
    for (const event of events) {
      body.append(
        detailItem({
          title: qualifiedName(event.eventType),
          metas: [{ value: shortType(event.eventType), full: event.eventType }]
        })
      );
    }
  }
  return details;
}

// Display helpers: derive short, scannable labels for the headline while the full
// value stays available via the meta `title`.
function monoShort(value: string): HTMLElement {
  const node = mono(shortHex(value));
  node.title = value;
  return node;
}

