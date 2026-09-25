import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBAGENT_MAX_DEPTH,
  MAX_SUBAGENT_DEPTH,
  MIN_SUBAGENT_MAX_DEPTH,
  isValidSubagentMaxDepth,
  normalizeSubagentMaxDepth,
} from "./subagent-depth.js";

describe("normalizeSubagentMaxDepth", () => {
  it("defaults to direct delegation and accepts bounded integer levels", () => {
    expect(normalizeSubagentMaxDepth(undefined)).toBe(DEFAULT_SUBAGENT_MAX_DEPTH);
    expect(normalizeSubagentMaxDepth(2)).toBe(2);
    expect(normalizeSubagentMaxDepth(MIN_SUBAGENT_MAX_DEPTH)).toBe(0);
    expect(normalizeSubagentMaxDepth(MAX_SUBAGENT_DEPTH)).toBe(MAX_SUBAGENT_DEPTH);
  });

  it("rejects fractional, non-numeric, and out-of-range values", () => {
    for (const value of ["2", 1.5, -1, MAX_SUBAGENT_DEPTH + 1, null]) {
      expect(normalizeSubagentMaxDepth(value)).toBe(DEFAULT_SUBAGENT_MAX_DEPTH);
      expect(isValidSubagentMaxDepth(value)).toBe(false);
    }
  });
});
