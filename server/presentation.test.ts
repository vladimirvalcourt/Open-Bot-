import { describe, expect, it } from "vitest";
import { presentSystemFields, systemLabel, systemText } from "../src/lib/presentation.ts";

describe("customer-facing system language", () => {
  it("translates known runtime codes", () => {
    expect(systemText("auth_required")).toBe("Sign-in required");
    expect(systemText("exit_before_result")).toBe("The provider stopped before returning a result.");
    expect(systemLabel("COMPOSIO_SEARCH_TOOLS")).toBe("Searching connected apps");
  });

  it("humanizes unknown snake-case codes without changing normal text", () => {
    expect(systemText("provider_session_expired")).toBe("Provider session expired");
    expect(systemText("Could not finish: provider_session_expired")).toBe("Could not finish: Provider session expired");
    expect(systemText("Could not reach the provider.")).toBe("Could not reach the provider.");
  });

  it("presents system-owned object fields without mutating contracts", () => {
    const raw = { kind: "project_note", error: "auth_required", text: "keep_this_user_text" };
    const shown = presentSystemFields(raw);
    expect(shown.kind).toBe("Project note");
    expect(shown.error).toBe("Sign-in required");
    expect(shown.text).toBe("keep_this_user_text");
    expect(raw.kind).toBe("project_note");
  });
});
