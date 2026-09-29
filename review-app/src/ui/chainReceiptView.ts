// Detailed chain facts used only by the Review disclosure. The standalone
// Receipt imports the graph-free summary module instead.
import type { PublicChainReceipt, PublicChainReceiptEvent, PublicChainReceiptInput } from "../../../src/core/action/suiChainReceiptReader.js";
import type { SuiChainReceiptPackageCall } from "../../../src/core/action/suiChainReceiptEvidence.js";
import { accordion, element, detailItem, mono, placeholder, row } from "./ui.js";
import { ptbGraphCard } from "./ptbDiagram.js";
import { qualifiedName, shortHex, shortType, suiAmount, typeName } from "../format.js";
import { t } from "../i18n/i18n.js";

export function chainReceiptDetails(receipt: PublicChainReceipt): HTMLElement {
  const node = element("div");
  for (const item of gasRows(receipt.gas)) node.append(item);
  if (receipt.gas.budgetMist !== undefined) node.append(row(t.receipt.gasBudget, suiAmount(receipt.gas.budgetMist)));
  if (receipt.gas.priceMist !== undefined) node.append(row(t.receipt.gasPrice, `${receipt.gas.priceMist} MIST`));
  if (receipt.gas.paymentObjectId !== undefined) node.append(row(t.receipt.gasPayment, mono(receipt.gas.paymentObjectId)));
  if (receipt.balanceChanges.length) {
    const balances = accordion("Balance change records");
    for (const change of receipt.balanceChanges) balances.body.append(detailItem({
      title: change.symbol ?? typeName(change.coinType), trailing: `${change.amountRaw} raw units`,
      metas: [{ label: "Account", value: change.address }, { value: change.coinType }]
    }));
    node.append(balances.details);
  }
  if (receipt.ptbGraph) node.append(ptbGraphCard({ source: "receipt", mermaid: receipt.ptbGraph.mermaid }));
  else node.append(placeholder("Input values or the transaction graph may be unavailable; missing details do not mean the transaction had no inputs."));
  node.append(inputsAccordion(receipt.inputs), moveCallsAccordion(receipt.packageCalls),
    objectChangesAccordion(receipt.objectTypes), eventsAccordion(receipt.events));
  return node;
}

// Total is already in the primary summary; this disclosure shows components.
export function gasRows(gas: { computationMist: string; storageMist: string; storageRebateMist: string }): HTMLElement[] {
  return [row(t.receipt.gasComputation, suiAmount(gas.computationMist)),
    row(t.receipt.gasStorage, suiAmount(gas.storageMist)), row(t.receipt.gasRebate, suiAmount(gas.storageRebateMist))];
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

