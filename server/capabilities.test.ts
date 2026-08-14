import { describe, expect, it } from "vitest";

import { capabilityRouterInstructions, resolveNamedItem } from "./capabilities.ts";

describe("capability router", () => {
  it("resolves exact, partial, and misspelled bot names", () => {
    const bots = [{ id: "1", name: "Researcher" }, { id: "2", name: "Campaign Operator" }];
    expect(resolveNamedItem("researcher", bots).item?.id).toBe("1");
    expect(resolveNamedItem("campaign", bots).item?.id).toBe("2");
    expect(resolveNamedItem("resercher", bots).item?.id).toBe("1");
  });

  it("does not silently choose between ambiguous names", () => {
    const bots = [{ id: "1", name: "Research One" }, { id: "2", name: "Research Two" }];
    const result = resolveNamedItem("research", bots);
    expect(result.item).toBeNull();
    expect(result.ambiguous).toHaveLength(2);
  });

  it("defines automatic routing, fallbacks, confirmations, and verification", () => {
    const prompt = capabilityRouterInstructions({ connectedApps: true, browser: true, computer: true, bots: true, memory: true, routines: true });
    expect(prompt).toContain("ordinary language");
    expect(prompt).toContain("connected app first, then the embedded browser, then computer control");
    expect(prompt).toContain("A request to draft or write content does not authorize sending");
    expect(prompt).toContain("ask_bot");
    expect(prompt).toContain("create_routine");
    expect(prompt).toContain("verify the provider result");
  });
});
