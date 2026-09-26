import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME, SERVER_VERSION } from "../src/mcp/serverInfo.js";
import { assertPackContents } from "../scripts/release-check.js";
import { MCP_RESOURCES } from "../src/mcp/resources.js";

type PackageJson = {
  private?: boolean;
  version: string;
  license?: string;
  publishConfig?: {
    access?: string;
    tag?: string;
  };
  files: string[];
  scripts: Record<string, string>;
};

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;

describe("npm release metadata", () => {
  it("is configured for public latest-tag publishing", () => {
    expect(packageJson.private).toBeUndefined();
    // Validate the semver shape, not an exact value — pinning the version drifts every release.
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    expect(PACKAGE_NAME).toBe("@stelis/say-ur-intent");
    expect(SERVER_VERSION).toBe(packageJson.version);
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.publishConfig).toEqual({ access: "public", tag: "latest" });
    expect(packageJson.scripts.prepublishOnly).toBe("npm run release:check");
  });

  it("allowlists only product protocol notes", () => {
    expect(packageJson.files).toContain("protocols/deepbook-v3.md");
    expect(packageJson.files).toContain("protocols/deepbook-margin.md");
    expect(packageJson.files).not.toContain("protocols/");
  });

  it("keeps the lockfile and Registry identity bound to the released package", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const server = JSON.parse(readFileSync("server.json", "utf8"));
    expect([lock.name, lock.packages[""].name, server.packages[0].identifier]).toEqual([pkg.name, pkg.name, pkg.name]);
    expect([lock.version, lock.packages[""].version, server.version, server.packages[0].version]).toEqual(Array(4).fill(pkg.version));
    expect(server.name).toBe(pkg.mcpName);
    expect(pkg.files).toContain("LICENSES/");
    expect(pkg.files.some((file: string) => file.startsWith("submission"))).toBe(false);
    expect(MCP_RESOURCES.some((resource) => resource.path.startsWith("submission/"))).toBe(false);
  });
});

// Archive requirements come from the deployed surfaces, independently of the
// checker: five internal cards, retained Settings page, and adapted backend code.
const archive = ["package.json", "README.md", "LICENSE", "dist/runtime/start.js", "docs/UTILITY_INDEX.md",
  "LICENSES/@mysten-sui-2.17.0-Apache-2.0.txt", ...MCP_RESOURCES.map((resource) => resource.path),
  ...["account", "receipt", "chart", "connect", "review"].flatMap((name) => [`dist/mcp-app/${name}.html`, `dist/mcp-app/${name}.notices.txt`]),
  ...["settings.js", "settings.css", "ui.css", "favicon.svg", "brand-light.svg", "brand-dark.svg"].map((name) => `dist/review-app/${name}`)];
const pack = (paths: string[]) => ({ filename: "fixture.tgz", files: paths.map((path) => ({ path })) });

it("accepts the complete current archive and rejects missing notices, backend license or Settings assets", () => {
  expect(() => assertPackContents(pack(archive))).not.toThrow();
  for (const missing of ["dist/mcp-app/review.notices.txt", "LICENSES/@mysten-sui-2.17.0-Apache-2.0.txt", "dist/review-app/settings.js"]) {
    expect(() => assertPackContents(pack(archive.filter((path) => path !== missing)))).toThrow(missing);
  }
});

it.each(["submission/ethglobal-tokyo-2026/plan.md", ".WORK/session.sqlite", "dist/review-app/connect.js"])("rejects the excluded archive path %s", (path) => {
  expect(() => assertPackContents(pack([...archive, path]))).toThrow(path);
});
