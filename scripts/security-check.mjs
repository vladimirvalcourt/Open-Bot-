import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const listed = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" });
if (listed.status !== 0) throw new Error(listed.stderr || "could not list repository files");
const files = listed.stdout.split(/\r?\n/).filter(Boolean).filter((file) =>
  file !== "scripts/security-check.mjs" &&
  !/^(?:node_modules|dist|dist-server|release|build|electron\/vendor)\//.test(file) &&
  !/\.(?:png|jpe?g|gif|icns|ico|zip|dmg|woff2?|mp[34]|wav|pdf|docx|xlsx|pptx)$/.test(file));

const checks = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: "live Stripe secret", pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { name: "disabled TLS validation", pattern: /(?:rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0)/, sourceOnly: true },
  { name: "shell-spawn execution", pattern: /shell\s*:\s*true/, sourceOnly: true },
];

const findings = [];
for (const file of files) {
  let text; try { text = readFileSync(file, "utf8"); } catch { continue; }
  for (const check of checks) {
    if (check.sourceOnly && !/\.(?:[cm]?js|tsx?|jsx)$/.test(file)) continue;
    const match = check.pattern.exec(text);
    if (match) findings.push({ file, line: text.slice(0, match.index).split("\n").length, check: check.name });
  }
}

if (findings.length) {
  for (const item of findings) console.error(`${item.file}:${item.line}: ${item.check}`);
  process.exitCode = 1;
} else {
  console.log(`Security checks passed across ${files.length} source files.`);
}
