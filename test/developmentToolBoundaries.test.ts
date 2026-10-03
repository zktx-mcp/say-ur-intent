import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import postcss from "postcss";
import { afterEach, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function mapFixture(): Promise<{ directory: string; input: string; inside: string; outside: string }> {
  const directory = await mkdtemp(join(tmpdir(), "sui-mcp-source-map-"));
  directories.push(directory);
  const inputDirectory = join(directory, "input");
  await mkdir(inputDirectory);
  const inside = join(inputDirectory, "allowed.map"), outside = join(directory, "outside.map");
  for (const [file, marker] of [[inside, "Q3_ALLOWED_MAP_CONTENT"], [outside, "Q3_OUTSIDE_MAP_CONTENT"]]) {
    await writeFile(file!, JSON.stringify({ version: 3, file: "source.css", sources: ["original.css"],
      sourcesContent: [marker], names: [], mappings: "AAAA" }));
  }
  return { directory, input: join(inputDirectory, "source.css"), inside, outside };
}

it("preserves supported same-directory previous source maps", async () => {
  const fixture = await mapFixture();
  const result = await postcss().process(".probe { color: green }\n/*# sourceMappingURL=allowed.map */", {
    from: fixture.input, to: join(fixture.directory, "output.css"), map: { inline: false, annotation: false }
  });
  expect(result.css).toContain("color: green");
  expect(result.map).toBeDefined();
  expect(result.map!.toString()).toContain("Q3_ALLOWED_MAP_CONTENT");
});

it.each(["relative traversal", "absolute traversal", "missing from"] as const)(
  "does not disclose an automatic previous map through %s", async (scenario) => {
    const fixture = await mapFixture();
    const annotation = scenario === "relative traversal"
      ? relative(join(fixture.directory, "input"), fixture.outside) : fixture.outside;
    const result = await postcss().process(`.probe { color: green }\n/*# sourceMappingURL=${annotation} */`, {
      ...(scenario === "missing from" ? {} : { from: fixture.input }),
      to: join(fixture.directory, "output.css"), map: { inline: false, annotation: false }
    });
    expect(result.css).toContain("color: green");
    expect(result.map).toBeDefined();
    expect(result.map!.toString()).not.toContain("Q3_OUTSIDE_MAP_CONTENT");
  }
);

it("ends zero and negative custom/non-secure ID requests without weakening positive generation", () => {
  // Match the runner's default five-second budget and kill only this child if a
  // vulnerable generator loops, so it cannot strand the test worker.
  const result = spawnSync(process.execPath, ["--input-type=commonjs", "--eval", `
    const { createRequire } = require("node:module");
    const load = createRequire(${JSON.stringify(join(process.cwd(), "package.json"))});
    const secure = load("nanoid"), plain = load("nanoid/non-secure");
    const empty = [plain.nanoid(0), plain.nanoid(-1), plain.customAlphabet("ab", 0)(),
      plain.customAlphabet("ab")(-1), secure.customAlphabet("ab", 0)(),
      secure.customAlphabet("ab")(-1), secure.customRandom("ab", 0, n => new Uint8Array(n))()];
    const positive = [plain.customAlphabet("ab", 6)(), secure.customAlphabet("ab", 6)()];
    process.stdout.write(JSON.stringify({ empty, positive }));
  `], { encoding: "utf8", timeout: 5_000, killSignal: "SIGKILL" });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout) as { empty: string[]; positive: string[] };
  // Empty output is the documented fix's boundary result; six is the explicit
  // caller input, rather than a length derived from the generator under test.
  expect(output.empty).toEqual(["", "", "", "", "", "", ""]);
  expect(output.positive).toHaveLength(2);
  for (const id of output.positive) expect(id).toMatch(/^[ab]{6}$/);
});
