import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("encrypted backup", () => {
  afterEach(() => vi.resetModules());

  it("round-trips approved data without exporting config credentials", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-backup-")); process.env.OMB_DATA_DIR = dir;
    writeFileSync(join(dir, "bots.json"), "[1]");
    writeFileSync(join(dir, "config.json"), JSON.stringify({ codespaces: { token: "secret" } }));
    const { createEncryptedBackup, restoreEncryptedBackup } = await import("./backup.ts");
    const envelope = createEncryptedBackup("correct horse battery staple");
    writeFileSync(join(dir, "bots.json"), "[]");
    expect(restoreEncryptedBackup(envelope, "correct horse battery staple")).toMatchObject({ restored: 1, restartRequired: true });
    expect(readFileSync(join(dir, "bots.json"), "utf8")).toBe("[1]");
    expect(envelope.ciphertext).not.toContain("secret");
  });

  it("rejects the wrong passphrase", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-backup-")); process.env.OMB_DATA_DIR = dir;
    writeFileSync(join(dir, "work.json"), "{}");
    const { createEncryptedBackup, restoreEncryptedBackup } = await import("./backup.ts");
    const envelope = createEncryptedBackup("correct horse battery staple");
    expect(() => restoreEncryptedBackup(envelope, "incorrect passphrase")).toThrow(/could not be decrypted/);
  });
});
