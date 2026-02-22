import { describe, it, expect } from "vitest";
import { filterPaths } from "../src/diff";

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
