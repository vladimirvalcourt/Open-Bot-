// In-app auto-updater (electron-updater), manual/button-driven — the same
// shape t3code's desktop app uses: autoDownload off, quitAndInstall on the
// user's "Restart to update" click. One state object is broadcast to the
// renderer on every transition; the renderer just renders it.
//
// Only runs in the packaged, signed+notarized app (mac auto-update requires
// signing). In dev it's a no-op so the browser/dev shell is unaffected.
// electron-updater is vendored (electron/vendor/electron-updater.cjs) because
// the packaged app ships no node_modules.
import { app, ipcMain } from "electron";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { teamIdentifierFromCodesign, updatePolicy } from "./updater-policy.mjs";

const require = createRequire(import.meta.url);

let autoUpdater = null;
let win = null;
// status: idle | checking | available | downloading | downloaded | error
let state = { status: "idle" };
let logFile = null;

function releaseChannel() {
  const dataDir = process.env.OMB_DATA_DIR || join(homedir(), ".openmausbot");
  try { return JSON.parse(readFileSync(join(dataDir, "governance.json"), "utf8"))?.release?.channel === "beta" ? "beta" : "stable"; }
  catch { return "stable"; }
}

function log(level, ...values) {
  try {
    if (!logFile) return;
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${values.map((value) => value instanceof Error ? (value.stack || value.message) : typeof value === "string" ? value : JSON.stringify(value)).join(" ")}\n`);
  } catch {}
}

function setState(patch) {
  state = { ...state, ...patch };
  try {
    win?.webContents?.send("update:state", state);
  } catch {
    /* window gone */
  }
}

async function check() {
  if (!autoUpdater) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    log("error", "check failed", e);
    setState({ status: "error", message: String(e?.message ?? e) });
  }
}

export function registerUpdaterIpc(assertSender = () => {}) {
  ipcMain.handle("update:get-state", (event) => { assertSender(event); return state; });
  ipcMain.handle("update:check", (event) => { assertSender(event); return check(); });
  ipcMain.handle("update:download", async (event) => {
    assertSender(event);
    try {
      if (!autoUpdater) throw new Error(state.message || "automatic updates are unavailable for this build");
      await autoUpdater.downloadUpdate();
    } catch (e) {
      log("error", "download failed", e);
      setState({ status: "error", message: String(e?.message ?? e) });
    }
  });
  ipcMain.handle("update:install", async (event) => {
    assertSender(event);
    // isSilent, isForceRunAfter — relaunch straight into the new version
    try {
      if (!autoUpdater) throw new Error(state.message || "automatic updates are unavailable for this build");
      // quitAndInstall is synchronous, but keeping this handler async makes
      // renderer-side failures and future promise-returning versions safe.
      await Promise.resolve(autoUpdater.quitAndInstall(true, true));
    } catch (e) {
      log("error", "install failed", e);
      setState({ status: "error", message: String(e?.message ?? e) });
    }
  });
}

export function startUpdater(mainWindow) {
  win = mainWindow;
  logFile = join(app.getPath("logs"), "updater.log");
  // dev / unsigned builds can't auto-update — leave the banner dormant
  if (!app.isPackaged) {
    setState({ status: "idle" });
    return;
  }
  let teamIdentifier = null;
  try {
    const inspected = spawnSync("/usr/bin/codesign", ["-dvvv", app.getPath("exe")], { encoding: "utf8" });
    teamIdentifier = teamIdentifierFromCodesign(`${inspected.stdout ?? ""}\n${inspected.stderr ?? ""}`);
  } catch {}
  const policy = updatePolicy(teamIdentifier);
  log("info", "startup", { version: app.getVersion(), teamIdentifier, updatesEnabled: policy.enabled });
  if (!policy.enabled) {
    setState({ status: "disabled", message: policy.reason });
    return;
  }
  try {
    ({ autoUpdater } = require("./vendor/electron-updater.cjs"));
  } catch {
    setState({ status: "error", message: "updater unavailable" });
    return;
  }
  autoUpdater.autoDownload = false; // button-driven download
  autoUpdater.autoInstallOnAppQuit = false; // button-driven install
  const channel = releaseChannel();
  autoUpdater.channel = channel;
  autoUpdater.allowPrerelease = channel === "beta";
  // Returning from beta to stable is the supported rollback path. The user
  // still chooses Download and Restart; no unattended downgrade occurs.
  autoUpdater.allowDowngrade = channel === "stable";
  state = { ...state, channel };
  autoUpdater.logger = {
    info: (...values) => log("info", ...values),
    warn: (...values) => log("warn", ...values),
    error: (...values) => log("error", ...values),
    debug: (...values) => log("debug", ...values),
  };

  autoUpdater.on("checking-for-update", () => setState({ status: "checking" }));
  autoUpdater.on("update-available", (info) =>
    setState({ status: "available", version: info?.version, message: undefined }),
  );
  autoUpdater.on("update-not-available", () => setState({ status: "idle" }));
  autoUpdater.on("download-progress", (p) =>
    setState({ status: "downloading", percent: Math.round(p?.percent ?? 0) }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    setState({ status: "downloaded", version: info?.version }),
  );
  autoUpdater.on("error", (e) => { log("error", "updater event", e); setState({ status: "error", message: String(e?.message ?? e) }); });

  // first check ~15s after launch (let the app settle), then hourly
  setTimeout(check, 15_000).unref?.();
  setInterval(check, 60 * 60 * 1000).unref?.();
}
