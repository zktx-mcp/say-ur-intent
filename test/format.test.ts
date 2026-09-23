import { describe, expect, it } from "vitest";
import {
  mistToSui,
  rawToDisplay,
  shortAddress,
  shortHex,
  shortType,
  signedRawToDisplay,
  suiAmount,
  SUI_DECIMALS
} from "../review-app/src/format.js";

// The shared client-side amount formatter (used by the review and receipt pages).
// These walk the real BigInt math so a regression in padding, trimming, or sign
// handling is caught, not just the function's existence.

describe("rawToDisplay", () => {
  it("places the decimal point and trims trailing zeros", () => {
    expect(rawToDisplay("1500000000", 9)).toBe("1.5");
    expect(rawToDisplay("1000000000", 9)).toBe("1");
    expect(rawToDisplay("5000000", 6)).toBe("5");
    expect(rawToDisplay("1", 9)).toBe("0.000000001");
    expect(rawToDisplay("0", 9)).toBe("0");
  });

  it("keeps every integer digit for large raw amounts (no float rounding)", () => {
    // 218.883618256 SUI — the kind of amount that would lose precision as a float.
    expect(rawToDisplay("218883618256", 9)).toBe("218.883618256");
  });

  it("treats zero decimals as a plain integer", () => {
    expect(rawToDisplay("42", 0)).toBe("42");
  });
});

describe("signedRawToDisplay", () => {
  it("preserves the sign and formats the magnitude", () => {
    expect(signedRawToDisplay("-218883618256", 9)).toBe("-218.883618256");
    expect(signedRawToDisplay("1193043120", 9)).toBe("1.19304312");
  });

  it("never renders a negative zero", () => {
    expect(signedRawToDisplay("0", 9)).toBe("0");
    expect(signedRawToDisplay("-0", 9)).toBe("0");
  });
});

describe("mistToSui", () => {
  it("formats mist using the known SUI decimals", () => {
    expect(SUI_DECIMALS).toBe(9);
    expect(mistToSui("275256")).toBe("0.000275256");
    expect(mistToSui("1000000000")).toBe("1");
  });

  it("preserves net gas refunds through the SUI display entry points", () => {
    // Receipt components: 123600 + 78561200 - 78761232 = -76432 MIST.
    // Expected decimal strings follow 1 SUI = 10^9 MIST, independently of the formatter.
    for (const [mist, display] of [
      ["-76432", "-0.000076432"],
      ["-1000000001", "-1.000000001"],
      ["0", "0"],
      ["-0", "0"],
      ["1000000001", "1.000000001"]
    ] as const) {
      expect(mistToSui(mist)).toBe(display);
      expect(suiAmount(mist)).toBe(`${display} SUI`);
    }
  });
});

// The shared shorteners (consumed by the review and receipt pages). Behavioral:
// they walk the real boundary lengths and, for types, the segment-aware logic.

describe("shortAddress", () => {
  it("collapses a long 0x value to head…tail and leaves a short one intact", () => {
    expect(shortAddress("0xa0766ff7b0325c18e4c7416ad4ea4d01e92f09147b8c5e7e4a582dc84ca3a874")).toBe("0xa076…a874");
    expect(shortAddress("0x2")).toBe("0x2");
  });

  it("shortens only above 12 characters", () => {
    expect(shortAddress("0x1234567890")).toBe("0x1234567890"); // 12 chars: untouched
    expect(shortAddress("0x12345678901")).toBe("0x1234…8901"); // 13 chars: shortened
  });
});

describe("shortHex", () => {
  it("uses a wider 8…6 window and shortens only above 14 characters", () => {
    expect(shortHex("0xa0766ff7b0325c18e4c7416ad4ea4d01e92f09147b8c5e7e4a582dc84ca3a874")).toBe("0xa0766f…a3a874");
    expect(shortHex("0x1234567890ab")).toBe("0x1234567890ab"); // 14 chars: untouched
    expect(shortHex("0x1234567890abc")).toBe("0x123456…890abc"); // 15 chars: shortened
  });
});

describe("shortType", () => {
  it("shortens only the long 0x package ids, keeping module/struct names and generics", () => {
    const pkg = `0x${"1".repeat(64)}`;
    const usdc = `0x${"2".repeat(64)}`;
    const type = `${pkg}::coin::Coin<${usdc}::usdc::USDC>`;
    expect(shortType(type)).toBe(`${shortHex(pkg)}::coin::Coin<${shortHex(usdc)}::usdc::USDC>`);
  });

  it("leaves a short package id untouched", () => {
    expect(shortType("0x2::sui::SUI")).toBe("0x2::sui::SUI");
  });
});
