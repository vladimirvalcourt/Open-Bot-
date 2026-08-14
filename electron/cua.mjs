// CUA computer-use wiring for the Electron main process.
//
// Two modes, per cua-driver's EMBEDDING.md:
//  - "embedded" (packaged app): spawn our own private daemon via
//    EmbeddedCuaDriverHost so TCC grants attribute to OpenMausBot and the
//    driver inherits them. One prompt, named OpenMausBot, out of the box.
//  - "standalone" (dev): attach to an already-installed CuaDriver.app daemon
//    (its own TCC identity, typically already granted on a dev machine).
//
// Agents never talk to the daemon socket directly — they spawn the official
// stdio MCP proxy: `cua-driver mcp [--embedded --socket <path>]`. The proxy
// executes nothing; the host-owned daemon does.
//
// The resulting connection descriptor is written to
// <userData>/cua-connection.json for the harness server to hand to drivers.

import { app, ipcMain, shell, systemPreferences } from "electron";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const INSTALLED_DRIVER = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const STANDALONE_SOCKET = path.join(
  app.getPath("home"),
  "Library/Caches/cua-driver/cua-driver.sock",
);
const HOST_BUNDLE_ID = "com.openmausbot.app";

let embeddedHost = null; // EmbeddedCuaDriverHost | null
let connection = null; // descriptor exposed to harness + renderer

function persistConnection(next) {
  connection = next;
  const connectionPath = path.join(app.getPath("userData"), "cua-connection.json");
  fs.writeFileSync(
    connectionPath,
    JSON.stringify(connection, null, 2),
    { mode: 0o600 },
  );
  fs.chmodSync(connectionPath, 0o600);
  return connection;
}

function readMacOSPermissions() {
  if (process.platform !== "darwin") {
    return { accessibility: false, screenRecording: false };
  }
  return {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screenRecording: systemPreferences.getMediaAccessStatus("screen") === "granted",
  };
}

function cuaSdkUrl(entrypoint) {
  if (!app.isPackaged) return `@trycua/cua-driver/${entrypoint}`;
  return pathToFileURL(
    path.join(
      process.resourcesPath,
      "cua-sdk/node_modules/@trycua/cua-driver/dist",
      `${entrypoint}.js`,
    ),
  ).href;
}

export function resolveDriverBinary() {
  if (process.env.CUA_DRIVER_PATH) return process.env.CUA_DRIVER_PATH;
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "cua-driver");
    if (fs.existsSync(bundled)) return bundled;
  }
  if (fs.existsSync(INSTALLED_DRIVER)) return INSTALLED_DRIVER;
  return null;
}

function socketAlive(sockPath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(sockPath)) return resolve(false);
    const s = net.createConnection(sockPath);
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    setTimeout(() => done(false), 1500).unref();
  });
}

async function startEmbedded(binary) {
  // Dynamic import: the SDK ships a native FFI lib; keep dev startup
  // resilient if it fails to load on this machine.
  const { EmbeddedCuaDriverHost } = await import(cuaSdkUrl("embedded"));
  embeddedHost = new EmbeddedCuaDriverHost(binary, HOST_BUNDLE_ID);
  const conn = await embeddedHost.start();
  return {
    mode: "embedded",
    socketPath: conn.socketPath,
    mcpCommand: binary,
    mcpArgs: ["mcp", "--embedded", "--socket", conn.socketPath],
    mcpEnv: { CUA_DRIVER_EMBEDDED: "1", CUA_DRIVER_HOST_BUNDLE_ID: HOST_BUNDLE_ID },
  };
}

export async function startCua() {
  const binary = resolveDriverBinary();
  if (!binary) {
    return persistConnection({ mode: "unavailable", reason: "cua-driver binary not found" });
  }

  const wantEmbedded =
    app.isPackaged || process.env.OPENMAUSBOT_CUA_EMBEDDED === "1";

  if (wantEmbedded) {
    try {
      const permissions = readMacOSPermissions();
      if (!permissions.accessibility || !permissions.screenRecording) {
        connection = {
          mode: "unavailable",
          reason: "computer permissions are required",
        };
      } else {
        connection = await startEmbedded(binary);
      }
    } catch (err) {
      connection = {
        mode: "unavailable",
        reason: `embedded host failed: ${err?.message ?? err}`,
      };
    }
  } else if (await socketAlive(STANDALONE_SOCKET)) {
    // Dev machine with CuaDriver.app's daemon already running.
    connection = {
      mode: "standalone",
      socketPath: STANDALONE_SOCKET,
      mcpCommand: binary,
      mcpArgs: ["mcp"],
      mcpEnv: {},
    };
  } else {
    connection = {
      mode: "unavailable",
      reason:
        "no running cua-driver daemon; run `cua-driver serve` or grant via `cua-driver permissions grant`",
    };
  }

  return persistConnection(connection);
}

export async function cuaPermissionsStatus() {
  const binary = resolveDriverBinary();
  if (!binary) {
    return { available: false, accessibility: false, screenRecording: false, connection };
  }
  try {
    const permissions = readMacOSPermissions();
    // A live embedded daemon is stronger evidence than macOS's cached
    // screen preflight result: startCua refuses to launch it without both
    // grants, while CGPreflight can stay stale until the host restarts.
    if (connection?.mode === "embedded") {
      permissions.accessibility = true;
      permissions.screenRecording = true;
    }
    return { available: true, ...permissions, connection };
  } catch (err) {
    return {
      available: true,
      accessibility: false,
      screenRecording: false,
      connection,
      error: err?.message ?? String(err),
    };
  }
}

export async function requestCuaPermissions() {
  if (process.platform !== "darwin" || !resolveDriverBinary()) {
    return cuaPermissionsStatus();
  }

  const {
    hasRequiredMacOSPermissions,
    openMacOSScreenRecordingSettings,
    requestMacOSPermissions,
  } =
    await import(cuaSdkUrl("electron"));
  // This is the only prompting call in the CUA flow. It is reached solely
  // from the renderer's explicit Enable action.
  const permissions = requestMacOSPermissions();
  if (!hasRequiredMacOSPermissions(permissions) && !permissions.screenRecording) {
    await openMacOSScreenRecordingSettings();
  }

  if (hasRequiredMacOSPermissions(permissions) && connection?.mode !== "embedded") {
    await stopCua();
    try {
      persistConnection(await startEmbedded(resolveDriverBinary()));
    } catch (err) {
      persistConnection({
        mode: "unavailable",
        reason: `embedded host failed: ${err?.message ?? err}`,
      });
    }
  }
  return cuaPermissionsStatus();
}

export async function stopCua() {
  if (embeddedHost) {
    try {
      await embeddedHost.stop();
      embeddedHost.uniffiDestroy?.();
    } catch {
      // daemon holds a parent-liveness pipe; host death closes it anyway
    }
    embeddedHost = null;
  }
}

export function registerCuaIpc(assertSender = () => {}) {
  ipcMain.handle("cua:connection", (event) => { assertSender(event); return connection; });
  ipcMain.handle("cua:permissions", (event) => { assertSender(event); return cuaPermissionsStatus(); });
  ipcMain.handle("cua:request-permissions", (event) => { assertSender(event); return requestCuaPermissions(); });
  ipcMain.handle("cua:open-settings", (event, pane) => {
    assertSender(event);
    const privacyPane = pane === "screen" ? "Privacy_ScreenCapture" : "Privacy_Accessibility";
    return shell.openExternal(
      `x-apple.systempreferences:com.apple.preference.security?${privacyPane}`,
    );
  });
  ipcMain.handle("cua:restart", async (event) => {
    assertSender(event);
    await stopCua();
    await startCua();
    return cuaPermissionsStatus();
  });
}
