import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NATIVE_DIR, ensureDirs } from "../config.ts";
import { appendNative } from "./native.ts";

describe("native protocol log redaction", () => {
  it("removes integration environments and authorization fields", () => {
    ensureDirs();
    const threadId = `redact-${Date.now()}`;
    appendNative(threadId, {
      dir: "out",
      source: "test",
      msg: { params: { mcpServers: [{ env: [{ name: "TOKEN", value: "top-secret" }] }] }, authorization: "Bearer secret" },
    });
    const text = readFileSync(join(NATIVE_DIR, `${threadId}.ndjson`), "utf8");
    expect(text).not.toContain("top-secret");
    expect(text).not.toContain("Bearer secret");
    expect(text).toContain("[REDACTED]");
  });
});
