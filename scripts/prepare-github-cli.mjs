import { createHash } from "node:crypto";
import { chmod, copyFile, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const VERSION = "2.94.0";
const ARCHIVE = `gh_${VERSION}_macOS_arm64.zip`;
const SHA256 = "4f9bc1a5e77500737290a307b40b4c396a4d23729f55340f2a83f414410165a1";
const URL = `https://github.com/cli/cli/releases/download/v${VERSION}/${ARCHIVE}`;
const output = path.resolve("build/github-cli/gh");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} failed (${code}): ${stderr.trim()}`)));
  });
}

const work = await mkdtemp(path.join(tmpdir(), "openmausbot-gh-"));
try {
  const response = await fetch(URL, { redirect: "follow" });
  if (!response.ok) throw new Error(`GitHub CLI download failed: HTTP ${response.status}`);
  const payload = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(payload).digest("hex");
  if (actual !== SHA256) throw new Error(`GitHub CLI checksum mismatch: expected ${SHA256}, got ${actual}`);
  const archivePath = path.join(work, ARCHIVE);
  await writeFile(archivePath, payload);
  await run("ditto", ["-x", "-k", archivePath, work]);
  const source = path.join(work, `gh_${VERSION}_macOS_arm64`, "bin", "gh");
  if (!(await stat(source).catch(() => null))?.isFile()) throw new Error("GitHub CLI archive layout changed");
  const description = await run("file", [source]);
  if (!description.includes("Mach-O") || !description.includes("arm64")) throw new Error(`unexpected GitHub CLI architecture: ${description}`);
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(source, output);
  await chmod(output, 0o755);
  console.log(`Prepared GitHub CLI ${VERSION} (${actual.slice(0, 12)})`);
} finally {
  await rm(work, { recursive: true, force: true });
}
