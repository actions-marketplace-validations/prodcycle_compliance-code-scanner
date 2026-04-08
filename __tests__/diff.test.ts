import { describe, it, expect, beforeEach } from "vitest";
import { filterPaths, readFileContents, parseDiffRanges, filterFindingsToDiff } from "../src/diff";
import type { ChangedFile, ValidateResponse, ScanFinding } from "../src/types";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("filterPaths", () => {
  const paths = [
    "infrastructure/main.tf",
    "infrastructure/modules/s3/main.tf",
    "src/app.ts",
    "docs/setup.md",
    "test/compliance.test.ts",
    "docker-compose.yml",
    ".github/workflows/ci.yml",
  ];

  it("returns all paths when no filters provided", () => {
    expect(filterPaths(paths, [], [])).toEqual(paths);
  });

  it("filters by include pattern", () => {
    const result = filterPaths(paths, ["*.tf"], []);
    expect(result).toEqual([]);
    // minimatch needs ** for subdirectory matching
    const result2 = filterPaths(paths, ["**/*.tf"], []);
    expect(result2).toEqual([
      "infrastructure/main.tf",
      "infrastructure/modules/s3/main.tf",
    ]);
  });

  it("filters by exclude pattern", () => {
    const result = filterPaths(paths, [], ["docs/**", "test/**"]);
    expect(result).toEqual([
      "infrastructure/main.tf",
      "infrastructure/modules/s3/main.tf",
      "src/app.ts",
      "docker-compose.yml",
      ".github/workflows/ci.yml",
    ]);
  });

  it("applies both include and exclude", () => {
    const result = filterPaths(
      paths,
      ["**/*.tf", "**/*.yml", "**/*.yaml"],
      [".github/**"],
    );
    expect(result).toEqual([
      "infrastructure/main.tf",
      "infrastructure/modules/s3/main.tf",
      "docker-compose.yml",
    ]);
  });

  it("returns empty array when include matches nothing", () => {
    const result = filterPaths(paths, ["**/*.go"], []);
    expect(result).toEqual([]);
  });
});

describe("readFileContents", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-test-"));
  });

  it("reads file contents from disk", () => {
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "const a = 1;");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "const b = 2;");

    const result = readFileContents(["a.ts", "b.ts"], tmpDir);
    expect(result).toEqual([
      { path: "a.ts", content: "const a = 1;" },
      { path: "b.ts", content: "const b = 2;" },
    ]);
  });

  it("skips files larger than 512 KB", () => {
    fs.writeFileSync(path.join(tmpDir, "big.ts"), "x".repeat(513 * 1024));
    fs.writeFileSync(path.join(tmpDir, "small.ts"), "ok");

    const result = readFileContents(["big.ts", "small.ts"], tmpDir);
    expect(result).toEqual([{ path: "small.ts", content: "ok" }]);
  });

  it("skips unreadable files", () => {
    const result = readFileContents(["nonexistent.ts"], tmpDir);
    expect(result).toEqual([]);
  });

  it("enforces the 500 file cap", () => {
    // Create 502 files
    for (let i = 0; i < 502; i++) {
      fs.writeFileSync(path.join(tmpDir, `f${i}.ts`), `file ${i}`);
    }
    const paths = Array.from({ length: 502 }, (_, i) => `f${i}.ts`);

    const result = readFileContents(paths, tmpDir);
    expect(result.length).toBe(500);
  });
});

describe("parseDiffRanges", () => {
  it("parses hunk headers from unified diff", () => {
    const patch = [
      "@@ -10,5 +10,7 @@ some context",
      " unchanged",
      "+added line 1",
      "+added line 2",
      " unchanged",
      "@@ -50,3 +52,4 @@ more context",
      "+new line",
    ].join("\n");

    const ranges = parseDiffRanges(patch);
    expect(ranges).toEqual([
      { start: 10, end: 16 },
      { start: 52, end: 55 },
    ]);
  });

  it("handles single-line hunks", () => {
    const patch = "@@ -1 +1 @@\n-old\n+new";
    const ranges = parseDiffRanges(patch);
    expect(ranges).toEqual([{ start: 1, end: 1 }]);
  });

  it("returns empty for no hunks", () => {
    expect(parseDiffRanges("")).toEqual([]);
  });
});

describe("filterFindingsToDiff", () => {
  function makeFinding(overrides: Partial<ScanFinding> = {}): ScanFinding {
    return {
      ruleId: "SOC2-3.5-01",
      controlId: "SOC2-3.5-01",
      severity: "high",
      confidence: "high",
      engine: "llm",
      framework: "soc2",
      resourceType: "code",
      resourcePath: "src/app.ts",
      resourceName: "app.ts",
      startLine: 10,
      endLine: 10,
      message: "Test finding",
      remediation: "Fix it",
      ...overrides,
    };
  }

  function makeResult(findings: ScanFinding[]): ValidateResponse {
    return {
      passed: false,
      findingsCount: findings.length,
      findings,
      summary: {
        total: findings.length,
        passed: 0,
        failed: findings.length,
        bySeverity: {},
        byFramework: {},
      },
      scanId: "test-scan",
    };
  }

  const diffPatch = [
    "@@ -8,5 +8,7 @@ context",
    " unchanged",
    "+added",
    "+added",
    " unchanged",
  ].join("\n");

  const files: ChangedFile[] = [
    { path: "src/app.ts", content: "...", diff: diffPatch },
  ];

  it("keeps findings within diff lines", () => {
    const finding = makeFinding({ startLine: 9, endLine: 10 });
    const result = filterFindingsToDiff(makeResult([finding]), files, ["high"]);
    expect(result.findings).toHaveLength(1);
  });

  it("drops findings outside diff lines", () => {
    const finding = makeFinding({ startLine: 100, endLine: 100 });
    const result = filterFindingsToDiff(makeResult([finding]), files, ["high"]);
    expect(result.findings).toHaveLength(0);
    expect(result.findingsCount).toBe(0);
  });

  it("drops findings for files not in the diff", () => {
    const finding = makeFinding({ resourcePath: "other/file.ts", startLine: 1, endLine: 1 });
    const result = filterFindingsToDiff(makeResult([finding]), files, ["high"]);
    expect(result.findings).toHaveLength(0);
  });

  it("recalculates passed status correctly when all fail-on findings removed", () => {
    const finding = makeFinding({ startLine: 500, endLine: 500, severity: "high" });
    const result = filterFindingsToDiff(makeResult([finding]), files, ["critical", "high"]);
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("keeps mixed findings correctly", () => {
    const inDiff = makeFinding({ startLine: 9, endLine: 9 });
    const outDiff = makeFinding({ startLine: 500, endLine: 500 });
    const result = filterFindingsToDiff(makeResult([inDiff, outDiff]), files, ["high"]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].startLine).toBe(9);
    expect(result.passed).toBe(false);
  });

  it("returns result as-is when no diffs are present", () => {
    const noDiffFiles: ChangedFile[] = [{ path: "src/app.ts", content: "..." }];
    const finding = makeFinding({ startLine: 100, endLine: 100 });
    const original = makeResult([finding]);
    const result = filterFindingsToDiff(original, noDiffFiles, ["high"]);
    expect(result.findings).toHaveLength(1);
  });
});
