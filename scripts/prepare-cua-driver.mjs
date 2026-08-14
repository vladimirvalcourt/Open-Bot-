import { createHash } from "node:crypto";
import { chmod, copyFile, cp, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const VERSION = "0.19.3";
const ARCHIVE = `cua-driver-rs-${VERSION}-darwin-arm64.tar.gz`;
const SHA256 = "4f147affe7015dffdb0faeecb784a72d4ff9808b571a2d888231ae11e7966034";
const URL = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${VERSION}/${ARCHIVE}`;
const output = path.resolve("build/cua-driver");
const sdkRoot = path.resolve("build/cua-sdk/node_modules");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} failed (${code}): ${stderr.trim()}`));
    });
  });
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

const work = await mkdtemp(path.join(tmpdir(), "openmausbot-cua-"));
try {
  const archivePath = path.join(work, ARCHIVE);
  const payload = await download(URL);
  const actual = createHash("sha256").update(payload).digest("hex");
  if (actual !== SHA256) {
    throw new Error(`CUA archive checksum mismatch: expected ${SHA256}, got ${actual}`);
  }
  await writeFile(archivePath, payload);
  await run("tar", ["-xzf", archivePath, "-C", work]);

  const source = path.join(work, `cua-driver-rs-${VERSION}-darwin-arm64`, "cua-driver");
  const sourceStat = await stat(source);
  if (!sourceStat.isFile()) throw new Error("CUA archive did not contain the expected executable");

  const description = await run("file", [source]);
  if (!description.includes("Mach-O") || !description.includes("arm64")) {
    throw new Error(`unexpected CUA executable architecture: ${description}`);
  }

  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(source, output);
  await chmod(output, 0o755);

  await rm(sdkRoot, { recursive: true, force: true });
  const driverPackage = await realpath(path.resolve("node_modules/@trycua/cua-driver"));
  const driverNodeModules = path.resolve(driverPackage, "../..");
  const ubjsNodePackage = await realpath(path.join(driverNodeModules, "@ubjs/node"));
  const ubjsNodeModules = path.resolve(ubjsNodePackage, "../..");
  const runtimePackages = new Map([
    ["@trycua/cua-driver", driverPackage],
    ["@trycua/cua-driver-darwin-arm64", path.join(driverNodeModules, "@trycua/cua-driver-darwin-arm64")],
    ["@ubjs/core", path.join(driverNodeModules, "@ubjs/core")],
    ["@ubjs/node", ubjsNodePackage],
    ["@ubjs/node-darwin-arm64", path.join(ubjsNodeModules, "@ubjs/node-darwin-arm64")],
  ]);
  for (const [packageName, sourcePackage] of runtimePackages) {
    const destinationPackage = path.join(sdkRoot, packageName);
    if (!(await stat(sourcePackage).catch(() => null))?.isDirectory()) {
      throw new Error(`required packaged CUA SDK dependency is missing: ${packageName}`);
    }
    await mkdir(path.dirname(destinationPackage), { recursive: true });
    await cp(sourcePackage, destinationPackage, { recursive: true, dereference: true });
  }

  const copied = await readFile(output);
  const binaryHash = createHash("sha256").update(copied).digest("hex");
  console.log(`Prepared CUA driver + embedded SDK ${VERSION} (${binaryHash.slice(0, 12)}, ${description.split(": ")[1]})`);
} finally {
  await rm(work, { recursive: true, force: true });
}
