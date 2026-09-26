import { describe, expect, it } from "vitest";
import {
  ADAPTER_PROMPT_SURFACES,
  actionGroups,
  adapterPromptSurfaceSchema,
  promptNameFor,
  type AdapterPromptSurface
} from "../src/adapters/adapterPromptSurfaces.js";
import { bareActionPromptText } from "../src/mcp/prompts.js";
import { buildSupportedReviewAdapterDescriptors } from "../src/adapters/reviewAdapters.js";

const unusedProducer = () => {
  throw new Error("not used by descriptor metadata");
};

const descriptorMetadata = buildSupportedReviewAdapterDescriptors({
  deepbook: {
    deepbookQuoteSource: { quoteDeepbookDisplayAmount: unusedProducer },
    deepbookTransactionMaterialProducer: unusedProducer,
    deepbookTransactionMaterialDigestProducer: unusedProducer,
    transactionObjectOwnershipProducer: unusedProducer,
    deepbookHumanReadableReviewProducer: unusedProducer,
    reviewTimeSimulationProducer: unusedProducer,
    ptbVisualizationProducer: unusedProducer
  }
});

describe("adapter prompt surfaces", () => {
  it("validates every registered surface against the schema", () => {
    for (const surface of ADAPTER_PROMPT_SURFACES) {
      expect(() => adapterPromptSurfaceSchema.parse(surface)).not.toThrow();
    }
  });

  it("binds every surface to a registered adapter descriptor", () => {
    const adapterIds = new Set(descriptorMetadata.map((descriptor) => descriptor.adapterId));
    for (const surface of ADAPTER_PROMPT_SURFACES) {
      expect(adapterIds.has(surface.adapterId)).toBe(true);
    }
  });

  it("produces unique action-first prompt names", () => {
    const names = ADAPTER_PROMPT_SURFACES.map((surface) => promptNameFor(surface));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("swap-deep");
  });

  it("keeps the bare action registered and routes by protocol choice", () => {
    const competitor: AdapterPromptSurface = {
      ...ADAPTER_PROMPT_SURFACES[0]!,
      adapterId: "other-swap",
      protocolSlug: "other",
      title: "Other Swap Review",
      toolName: "action.prepare_other_action_review"
    };
    const single = actionGroups(ADAPTER_PROMPT_SURFACES.filter((surface) => surface.protocolSlug === "deep"));
    expect(single.get("swap")).toHaveLength(1);

    expect(actionGroups(ADAPTER_PROMPT_SURFACES).get("swap")).toHaveLength(1);

    const contested = [...ADAPTER_PROMPT_SURFACES, competitor];
    expect(actionGroups(contested).get("swap")).toHaveLength(2);

    // No protocol chosen: the prompt must list options and forbid silent
    // venue selection.
    const ask = bareActionPromptText("swap", contested, "10 sui to usdc");
    expect(ask).toContain("Several protocols support the swap action");
    expect(ask).toContain("deep (");
    expect(ask).toContain("other (");
    expect(ask).toContain("Do not pick a protocol on your own.");

    // Protocol chosen: route straight to that surface's tool.
    const direct = bareActionPromptText("swap", contested, "10 sui to usdc", "other");
    expect(direct).toContain("action.prepare_other_action_review");
    expect(direct).not.toContain("Do not pick a protocol on your own.");
  });
});
