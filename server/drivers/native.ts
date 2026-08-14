// Native (un-normalized) protocol tee — the debugging trick from upstream's
// EventNdjsonLogger and agentcal's onRaw: every provider-native message is
// written verbatim next to the canonical stream, so protocol drift can be
// diagnosed by diffing the two.
import { appendFileSync, chmodSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NATIVE_DIR } from "../config.ts";

export function redactNative(value: unknown, key = ""): unknown {
  if (/^(?:authorization|headers?|env|token|apiKey|secret|password)$/i.test(key) || /(?:TOKEN|SECRET|PASSWORD|AUTHORIZATION|MCP_HEADERS)$/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactNative(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redactNative(child, childKey)]));
  return value;
}

/** One-time-compatible repair for logs written before structured redaction. */
export function scrubNativeLogs() {
  let names: string[] = [];
  try { names = readdirSync(NATIVE_DIR).filter((name) => name.endsWith(".ndjson")); } catch { return; }
  for (const name of names) {
    const path = join(NATIVE_DIR, name); const temp = `${path}.redacted`;
    try {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
        try { return JSON.stringify(redactNative(JSON.parse(line))); }
        catch { return JSON.stringify({ at: new Date().toISOString(), source: "legacy", msg: "[UNPARSEABLE LOG ENTRY REMOVED]" }); }
      });
      writeFileSync(temp, `${lines.join("\n")}${lines.length ? "\n" : ""}`, { mode: 0o600 });
      renameSync(temp, path); try { chmodSync(path, 0o600); } catch {}
    } catch {}
  }
}

export function appendNative(threadId: string, entry: { dir: "in" | "out"; source: string; msg: unknown }) {
  try {
    const path = join(NATIVE_DIR, `${threadId}.ndjson`);
    appendFileSync(
      path,
      JSON.stringify(redactNative({ at: new Date().toISOString(), ...entry })) + "\n",
      { mode: 0o600 },
    );
    try { chmodSync(path, 0o600); } catch {}
  } catch {
    /* never let logging break a run */
  }
}
