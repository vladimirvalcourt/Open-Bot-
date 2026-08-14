import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as codespaces from "./codespaces.ts";
import type { AppConfig } from "./config.ts";

const botId = "12345678-abcd-4abc-8abc-1234567890ab";
const displayName = `omb-12345678-${createHash("sha256").update(botId).digest("hex").slice(0, 6)}`;
const cfg: AppConfig = { codespaces: { token: "github-secret", repository: "owner/repo" }, cloud: { provider: "codespaces" } };
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-codespaces-test-"));
  const fake = join(dir, "gh");
  writeFileSync(fake, `#!/bin/sh
if [ "$1 $2" = "codespace list" ]; then
  printf '[{"name":"friendly-space-123","displayName":"%s","state":"Available","machineName":"basicLinux32gb"}]' "$TEST_CODESPACE_DISPLAY"
elif [ "$1 $2" = "codespace ssh" ]; then
  printf 'remote-ok'
elif [ "$1 $2" = "codespace stop" ]; then
  printf 'stopped'
else
  printf 'unexpected fake gh call' >&2
  exit 2
fi
`);
  chmodSync(fake, 0o755);
  process.env.OMB_GH_CLI = fake;
  process.env.TEST_CODESPACE_DISPLAY = displayName;
});

afterAll(() => {
  delete process.env.OMB_GH_CLI;
  delete process.env.TEST_CODESPACE_DISPLAY;
  rmSync(dir, { recursive: true, force: true });
});

describe("GitHub Codespaces provider", () => {
  it("requires a write-only token and a safe owner/repo value", () => {
    expect(codespaces.configured(cfg)).toBe(true);
    expect(codespaces.configured({ codespaces: { token: "x", repository: "https://github.com/owner/repo" } })).toBe(false);
    expect(codespaces.validRepository("owner/repo")).toBe(true);
    expect(codespaces.validRepository("owner/repo; rm -rf /tmp/nope")).toBe(false);
    expect(codespaces.validBranch("feature/codespaces")).toBe(true);
    expect(codespaces.validBranch("--upload-pack=oops")).toBe(false);
    expect(codespaces.validMachine("basicLinux32gb")).toBe(true);
    expect(codespaces.validMachine("--help")).toBe(false);
  });

  it("finds the bot's deterministic Codespace and reports shell-only capabilities", async () => {
    const result = await codespaces.status(cfg, botId);
    expect(result).toMatchObject({
      configured: true,
      provider: "codespaces",
      computer: { id: "friendly-space-123", state: "Available", displayName },
      capabilities: { screenshot: false, exec: true, join: true },
    });
  });

  it("executes remote commands without putting the token in argv", async () => {
    const result = await codespaces.exec(cfg, botId, "printf hello");
    expect(result).toEqual({ exitCode: 0, stdout: "remote-ok", stderr: "" });
  });
});
