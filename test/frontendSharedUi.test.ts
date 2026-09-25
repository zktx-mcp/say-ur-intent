import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { themeToggleIcon } from "../review-app/src/ui/shell.js";

describe("theme toggle icon reflects the current theme (Plan B)", () => {
  // The toggle must show the icon for the theme that is active right now, not the
  // theme it would switch to: a moon while dark, a sun while light. The moon glyph
  // is one distinctive path; the sun is a centre circle with rays.
  it("shows a moon while dark", () => {
    const icon = themeToggleIcon("dark");
    expect(icon).toContain("M21 12.8");
    expect(icon).not.toContain("circle");
  });

  it("shows a sun while light", () => {
    const icon = themeToggleIcon("light");
    expect(icon).toContain('circle cx="12" cy="12" r="4"');
    expect(icon).not.toContain("M21 12.8");
  });
});

const BARE_INTERACTIVE_ELEMENTS = ["button", "input", "select", "textarea"];

it("internal cards do not invoke clipboard APIs or offer copy controls", () => {
  for (const file of ["src/mcp-ui/view/lifecycle.ts", "src/mcp-ui/view/account.ts", "src/mcp-ui/view/receipt.ts", "src/mcp-ui/view/chart.ts", "review-app/src/ui/ptbDiagram.ts"]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source, file).not.toMatch(/navigator\.clipboard|execCommand|copyTextButton|copyIconButton|copyButton|Copy Markdown/);
  }
});

function readCss(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function selectorsOf(cssSource: string): string[] {
  const withoutComments = cssSource.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutComments
    .split("}")
    .map((block) => block.split("{")[0] ?? "")
    .flatMap((selectorList) => selectorList.split(","))
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0 && !selector.startsWith("@"));
}

function targetsBareInteractiveElement(selector: string): boolean {
  return selector.split(/[\s>+~]+/).some((compound) => {
    const head = compound.match(/^[a-zA-Z]+/)?.[0]?.toLowerCase();
    return head !== undefined && BARE_INTERACTIVE_ELEMENTS.includes(head);
  });
}

describe("shared-vs-page styling boundary (Plan B B1)", () => {
  it("the shared stylesheet owns the ui- atomic components", () => {
    const ui = readCss("review-app/public/ui.css");
    const atoms = [
      ".ui-shell",
      ".ui-header",
      ".ui-nav",
      ".ui-btn",
      ".ui-btn-row",
      ".ui-input",
      ".ui-card",
      ".ui-row",
      ".ui-badge",
      ".ui-pill",
      ".ui-chip",
      ".ui-wallet-chip",
      ".ui-wallet-chip-dot",
      ".ui-agent-badge",
      ".ui-select",
      ".ui-status-banner",
      ".ui-detail-item",
      ".ui-ptb-graph",
      ".ui-accordion",
      ".ui-feedback",
      ".ui-toast",
      ".ui-placeholder",
      ".ui-skeleton",
      ".ui-overlay"
    ];
    for (const atom of atoms) {
      expect(ui, `ui.css declares ${atom}`).toContain(atom);
    }
  });

  // Pages migrated onto the shared module in Unit B1. Later units add their pages
  // to this list as they migrate.
  const migratedPageCss = [
    "review-app/src/account.css",
    "src/mcp-ui/view/workflow.css",
    "review-app/src/receipt.css",
    "review-app/src/settings.css"
  ];

  it("migrated page stylesheets declare no ui- class rule and no bare interactive-element rule", () => {
    for (const path of migratedPageCss) {
      for (const selector of selectorsOf(readCss(path))) {
        expect(selector.includes(".ui-"), `${path}: "${selector}" must not target a shared atom`).toBe(false);
        expect(
          targetsBareInteractiveElement(selector),
          `${path}: "${selector}" must not style a bare interactive element`
        ).toBe(false);
      }
    }
  });
});
