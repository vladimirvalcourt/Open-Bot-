import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(join(tmpdir(), "omb-attachments-"));
vi.mock("./config.ts", () => ({ DATA_DIR: root }));

describe("AttachmentStore", () => {
  beforeEach(() => vi.resetModules());
  it("returns opaque metadata and resolves only stored IDs", async () => {
    const { AttachmentStore } = await import("./attachments.ts");
    const store = new AttachmentStore();
    const safe = store.save({ name: "notes.txt", mime: "text/plain", base64: Buffer.from("hello").toString("base64") });
    expect(safe).not.toHaveProperty("path");
    expect(store.resolve([safe.id])).toHaveLength(1);
    expect(store.resolve(["../../etc/passwd"])).toEqual([]);
    expect(readFileSync(store.resolve([safe.id])[0].path, "utf8")).toBe("hello");
  });
  it("rejects executable extensions and oversized files", async () => {
    const { AttachmentStore } = await import("./attachments.ts");
    const store = new AttachmentStore();
    expect(() => store.save({ name: "evil.app", mime: "application/octet-stream", base64: "eA==" })).toThrow("unsupported");
    expect(() => store.save({ name: "big.txt", mime: "text/plain", base64: Buffer.alloc(20 * 1024 * 1024 + 1).toString("base64") })).toThrow("20 MB");
  });
});
