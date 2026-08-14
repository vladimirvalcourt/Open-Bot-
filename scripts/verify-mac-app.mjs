import { access, constants, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function run(command, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(`${command} failed (${code}): ${result.stderr}`));
    });
  });
}

function teamId(details, label) {
  const match = details.match(/^TeamIdentifier=(.+)$/m);
  if (!match || match[1] === "not set") throw new Error(`${label} has no signing Team ID`);
  return match[1];
}

const localOnly = process.argv.includes("--local");
const suppliedPath = process.argv.slice(2).find((value) => value !== "--local");
const appPath = path.resolve(suppliedPath ?? "release/mac-arm64/OpenMausBot.app");
const driverPath = path.join(appPath, "Contents/Resources/cua-driver");
const githubCliPath = path.join(appPath, "Contents/Resources/github-cli/gh");
const keychainHelperPath = path.join(appPath, "Contents/Resources/keychain-helper");
const composioRuntimePath = path.join(appPath, "Contents/Resources/server/composio-runtime.js");
const sdkPath = path.join(
  appPath,
  "Contents/Resources/cua-sdk/node_modules/@trycua/cua-driver/dist/embedded.js",
);
const nativePaths = [
  driverPath,
  githubCliPath,
  keychainHelperPath,
  path.join(
    appPath,
    "Contents/Resources/cua-sdk/node_modules/@trycua/cua-driver-darwin-arm64/libcua_driver_sdk.dylib",
  ),
  path.join(
    appPath,
    "Contents/Resources/cua-sdk/node_modules/@trycua/cua-driver-darwin-arm64/cua_driver_node_runtime.node",
  ),
  path.join(
    appPath,
    "Contents/Resources/cua-sdk/node_modules/@ubjs/node-darwin-arm64/uniffi-runtime-napi.darwin-arm64.node",
  ),
];
if (!(await stat(appPath).catch(() => null))?.isDirectory()) {
  throw new Error(`app bundle not found: ${appPath}`);
}
await access(driverPath, constants.X_OK);
await access(githubCliPath, constants.X_OK);
await access(sdkPath, constants.R_OK);
await access(composioRuntimePath, constants.R_OK);
for (const nativePath of nativePaths.slice(1)) await access(nativePath, constants.R_OK);

const architectures = (await run("lipo", ["-archs", driverPath])).stdout.split(/\s+/);
if (!architectures.includes("arm64")) throw new Error(`CUA driver lacks arm64: ${architectures.join(" ")}`);

await run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
const appDetails = (await run("codesign", ["-dv", "--verbose=4", appPath])).stderr;
const appTeam = teamId(appDetails, "OpenMausBot");
if (!/flags=.*runtime/m.test(appDetails)) throw new Error("OpenMausBot lacks hardened runtime signing");
for (const nativePath of nativePaths) {
  await run("codesign", ["--verify", "--strict", "--verbose=2", nativePath]);
  const details = (await run("codesign", ["-dv", "--verbose=4", nativePath])).stderr;
  const nativeTeam = teamId(details, path.basename(nativePath));
  if (appTeam !== nativeTeam) {
    throw new Error(`signing Team ID mismatch: app=${appTeam}, ${path.basename(nativePath)}=${nativeTeam}`);
  }
  if (!/flags=.*runtime/m.test(details)) {
    throw new Error(`${path.basename(nativePath)} lacks hardened runtime signing`);
  }
}

const gatekeeper = localOnly
  ? { code: 0, stdout: "local verification requested", stderr: "" }
  : await run("spctl", ["--assess", "--type", "execute", "--verbose=2", appPath], { allowFailure: true });
if (gatekeeper.code !== 0) throw new Error(`Gatekeeper rejected the app: ${gatekeeper.stderr || gatekeeper.stdout}`);

console.log(`Verified ${appPath}`);
console.log(`CUA architectures: ${architectures.join(", ")}; Team ID: ${appTeam}; Gatekeeper: ${localOnly ? "skipped for local development build" : "accepted"}`);
