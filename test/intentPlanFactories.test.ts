import { describe, expect, it } from "vitest";
import {
  INTENT_PLAN_FACTORIES,
  resolveIntentPlanFactory,
  swapIntentInputSchema,
  type IntentPlanFactory
} from "../src/adapters/intentPlanFactories.js";
import { ADAPTER_PROMPT_SURFACES } from "../src/adapters/adapterPromptSurfaces.js";
import { SUPPORTED_PROTOCOLS } from "../src/mcp/tools/read/index.js";

const competitor: IntentPlanFactory = {
  ...INTENT_PLAN_FACTORIES[0]!,
  adapterId: "other-swap",
  protocolSlug: "other",
  protocol: "OtherSwap"
};

describe("intent plan factories", () => {
  it("resolves a single registered protocol without an explicit slug", () => {
    const single = INTENT_PLAN_FACTORIES.filter((factory) => factory.protocolSlug === "deep");
    const resolution = resolveIntentPlanFactory(single, "swap");
    expect(resolution.status).toBe("resolved");
    if (resolution.status === "resolved") {
      expect(resolution.factory.adapterId).toBe("deepbook-swap");
    }
  });

  it("rejects the removed protocol instead of substituting another adapter", () => {
    expect(resolveIntentPlanFactory(INTENT_PLAN_FACTORIES, "swap", "flowx")).toEqual({
      status: "unknown_protocol", protocolSlug: "flowx", available: ["deep"]
    });
  });

  it("refuses to pick a venue silently once two protocols share an action", () => {
    const contested = [...INTENT_PLAN_FACTORIES, competitor];
    const resolution = resolveIntentPlanFactory(contested, "swap");
    expect(resolution).toMatchObject({
      status: "protocol_choice_required",
      available: ["deep", "other"]
    });
    const explicit = resolveIntentPlanFactory(contested, "swap", "other");
    expect(explicit.status).toBe("resolved");
  });

  it("reports unknown protocols with the available slugs", () => {
    const resolution = resolveIntentPlanFactory(INTENT_PLAN_FACTORIES, "swap", "nope");
    expect(resolution).toMatchObject({ status: "unknown_protocol", available: ["deep"] });
  });

  it("reports unsupported action kinds", () => {
    expect(resolveIntentPlanFactory(INTENT_PLAN_FACTORIES, "stake")).toMatchObject({
      status: "unsupported_action"
    });
  });

  it("keeps factory slugs aligned with the prompt surfaces", () => {
    for (const factory of INTENT_PLAN_FACTORIES) {
      const surface = ADAPTER_PROMPT_SURFACES.find((candidate) => candidate.adapterId === factory.adapterId);
      expect(surface, factory.adapterId).toBeDefined();
      expect(surface?.action).toBe(factory.actionKind);
      expect(surface?.protocolSlug).toBe(factory.protocolSlug);
    }
  });

  it("accepts the protocol-neutral swap intent with and without a protocol slug", () => {
    const base = {
      type: "swap",
      from: { symbol: "SUI", amount: "1" },
      to: { symbol: "USDC" },
      maxSlippageBps: 50
    };
    expect(swapIntentInputSchema.safeParse(base).success).toBe(true);
    expect(swapIntentInputSchema.safeParse({ ...base, protocol: "deep" }).success).toBe(true);
  });

  it("orders swap protocols consistently across selection, prompt, and status surfaces", () => {
    const factoryOrder = INTENT_PLAN_FACTORIES.filter((factory) => factory.actionKind === "swap").map(
      (factory) => factory.protocolSlug
    );
    const surfaceOrder = ADAPTER_PROMPT_SURFACES.filter((surface) => surface.action === "swap").map(
      (surface) => surface.protocolSlug
    );
    // The user picks a venue from these surfaces, so they must offer the same
    // registered order, independent of how many adapters are installed.
    expect(factoryOrder).toEqual(["deep"]);
    expect(surfaceOrder).toEqual(factoryOrder);
    // The status list leads with the swap venues in the same order before the
    // notes-only margin entry.
    const statusSwapVenues = SUPPORTED_PROTOCOLS.filter((protocol) => protocol.support === "read_and_local_review").map((protocol) => protocol.id);
    expect(statusSwapVenues).toEqual(["deepbook-v3"]);
  });
});
