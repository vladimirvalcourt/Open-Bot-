import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { DATA_DIR } from "./config.ts";

export interface McpSpawnConfig { command: string; args: string[]; env: Record<string, string> }

const proxyPath = (() => {
  const ts = join(dirname(fileURLToPath(import.meta.url)), "secure-integration-proxy.ts");
  return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();

/**
 * Move an MCP server's environment into a single-use 0600 file. Provider CLIs
 * receive only the file path in argv/protocol configuration, never credentials.
 * The proxy unlinks the file immediately after reading it and forwards stdio.
 */
export function sealIntegration(input: McpSpawnConfig): McpSpawnConfig {
  if (!Object.keys(input.env).length) return input;
  const dir = join(DATA_DIR, "integration-secrets");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
  // A provider that fails before spawning the proxy cannot consume its file.
  // Remove abandoned envelopes; live proxies unlink theirs immediately.
  try {
    for (const name of readdirSync(dir)) {
      const candidate = join(dir, name);
      try { if (Date.now() - statSync(candidate).mtimeMs > 60 * 60_000) unlinkSync(candidate); } catch {}
    }
  } catch {}
  const path = join(dir, `${Date.now()}-${process.pid}-${randomBytes(12).toString("hex")}.json`);
  writeFileSync(path, JSON.stringify(input.env), { mode: 0o600, flag: "wx" });
  try { chmodSync(path, 0o600); } catch {}
  return {
    command: process.execPath,
    args: [proxyPath, path, input.command, ...input.args],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}
