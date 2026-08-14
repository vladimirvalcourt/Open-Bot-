import { describe, expect, it } from "vitest";

import { connectedAppsInstructions } from "./composio.ts";

describe("connected app routing instructions", () => {
  const prompt = connectedAppsInstructions();

  it("requires runtime discovery instead of asking the user to invoke a plugin", () => {
    expect(prompt).toContain("COMPOSIO_SEARCH_TOOLS first");
    expect(prompt).toContain("obvious misspellings");
    expect(prompt).toContain("'linkding' meaning LinkedIn");
    expect(prompt).toContain("Do not claim that an app or plugin is unavailable");
    expect(prompt).toContain("ask the user to tag it");
  });

  it("continues through connection, execution, and result verification", () => {
    expect(prompt).toContain("COMPOSIO_MANAGE_CONNECTIONS");
    expect(prompt).toContain("COMPOSIO_MULTI_EXECUTE_TOOL");
    expect(prompt).toContain("carry it through and verify the provider result");
  });
});
