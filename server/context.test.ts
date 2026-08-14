import { describe, expect, it } from "vitest";
import { compactTranscript } from "./context.ts";
describe("compactTranscript", () => {
  it("keeps small histories unchanged and compacts large ones at a user boundary", () => {
    const small = [{ role: "user" as const, text: "hello" }];
    expect(compactTranscript(small, 100)).toBe(small);
    const large = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, text: `${i}-${"x".repeat(100)}` }));
    const compacted = compactTranscript(large, 500, 250);
    expect(compacted[0].text).toContain("Summary of earlier conversation");
    expect(compacted.some((item) => item.text.startsWith("18-"))).toBe(true);
  });
});
