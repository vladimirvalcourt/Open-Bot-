import { app, BrowserWindow, WebContentsView, Notification, desktopCapturer, ipcMain, session, shell, systemPreferences, utilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { startCua, stopCua, registerCuaIpc } from "./cua.mjs";
import { startSpeech, stopSpeech } from "./speech.mjs";
import { startUpdater, registerUpdaterIpc } from "./updater.mjs";
import { BrowserNavigationCoordinator, safeBrowserUrl } from "./browser-navigation.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.OMB_E2E_USER_DATA) app.setPath("userData", process.env.OMB_E2E_USER_DATA);
// 127.0.0.1 explicitly — vite binds IPv4; a bare "localhost" here can
// resolve to ::1 and paint a black window
const DEV_URL = process.env.ELECTRON_START_URL ?? "http://127.0.0.1:5199";
let SERVER_PORT = 8799;
const APP_ICON = path.join(__dirname, "resources/app-icon.png");

// Packaged: the harness server ships in Resources (compiled JS, zero deps)
// and runs on Electron's own Node via utilityProcess. It serves the built
// UI too, so the window talks to one origin and there is no dev proxy.
// A stray server on the default port must not brick the app — fall back to
// alternate ports until one binds AND identifies as ours (the probe checks
// our API shape, not just a 200).
let serverProc = null;
let serverReady = true;
const browserViews = new Map();
const browserNavigation = new BrowserNavigationCoordinator();
const browserRefs = new Map();
const browserTeaching = new Map();
const teachDebuggerBound = new Set();
const BROWSER_TOKEN = randomBytes(32).toString("hex");
const APP_TOKEN = randomBytes(32).toString("base64url");
let browserBridge = null;
let mainWindow = null;

function crashReportingEnabled() {
  const dataDir = process.env.OMB_DATA_DIR || path.join(os.homedir(), ".openmausbot");
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, "governance.json"), "utf8"))?.privacy?.crashReports === true; }
  catch { return false; }
}

function recordCrash(kind, detail) {
  if (!crashReportingEnabled()) return;
  const dataDir = process.env.OMB_DATA_DIR || path.join(os.homedir(), ".openmausbot");
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(dataDir, "crashes.ndjson"), JSON.stringify({ at: Date.now(), kind: String(kind).slice(0, 80), detail: String(detail ?? "").slice(0, 500), version: app.getVersion() }) + "\n", { mode: 0o600 });
  } catch {}
}
process.on("uncaughtExceptionMonitor", (error) => recordCrash("main-process", error?.message));

function assertMainRenderer(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("untrusted IPC sender");
}

function safeBotId(value) {
  const botId = String(value ?? "");
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(botId)) throw Object.assign(new Error("invalid bot id"), { status: 400 });
  return botId;
}

function safeBrowserBounds(value) {
  const bounds = value && typeof value === "object" ? value : {};
  const numbers = [bounds.x, bounds.y, bounds.width, bounds.height].map(Number);
  if (!numbers.every(Number.isFinite)) throw new Error("invalid browser bounds");
  return {
    x: Math.round(numbers[0]),
    y: Math.round(numbers[1]),
    width: Math.max(1, Math.min(10_000, Math.round(numbers[2]))),
    height: Math.max(1, Math.min(10_000, Math.round(numbers[3]))),
  };
}

function ensureBrowser(botId, sender) {
  const win = sender ? BrowserWindow.fromWebContents(sender) : mainWindow;
  if (!win) throw new Error("browser window is unavailable");
  let entry = browserViews.get(botId);
  if (!entry) {
    const view = new WebContentsView({ webPreferences: { partition: `persist:bot-${botId}`, contextIsolation: true, sandbox: true } });
    view.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
    view.webContents.setUserAgent(view.webContents.getUserAgent().replace(/ Electron\/[^ ]+/, ""));
    win.contentView.addChildView(view);
    // Agent tools may create the browser before the user opens its pane.
    // Give that off-pane view a real viewport so layout, AX, and screenshots
    // work; BrowserPanel replaces these bounds when it becomes visible.
    view.setBounds({ x: 0, y: 0, width: 1024, height: 720 });
    view.setVisible(true);
    entry = { view, win };
    browserViews.set(botId, entry);
  }
  return entry;
}

const TEACH_CAPTURE_SCRIPT = `(() => {
  if (window.__ombTeachCapture) return;
  window.__ombTeachCapture = true;
  const describe = (el) => ({
    tag: el.tagName?.toLowerCase() || '',
    role: el.getAttribute?.('role') || '',
    name: el.getAttribute?.('aria-label') || el.innerText?.trim().slice(0,80) || el.getAttribute?.('name') || '',
    type: el.getAttribute?.('type') || '',
  });
  document.addEventListener('click', (event) => { const el = event.target?.closest?.('button,a,input,select,textarea,[role]') || event.target; window.ombTeach?.(JSON.stringify({ action:'click', target:describe(el), url:location.href, at:Date.now() })); }, true);
  document.addEventListener('change', (event) => { const el = event.target; window.ombTeach?.(JSON.stringify({ action:'input', target:describe(el), value:'<input>', url:location.href, at:Date.now() })); }, true);
})();`;

async function startTeaching(botId) {
  const entry = ensureBrowser(botId);
  browserTeaching.set(botId, []);
  await cdp(entry.view, "Runtime.enable");
  await cdp(entry.view, "Page.enable");
  await cdp(entry.view, "Runtime.addBinding", { name: "ombTeach" }).catch(() => {});
  await cdp(entry.view, "Page.addScriptToEvaluateOnNewDocument", { source: TEACH_CAPTURE_SCRIPT });
  await cdp(entry.view, "Runtime.evaluate", { expression: TEACH_CAPTURE_SCRIPT }).catch(() => {});
  if (!teachDebuggerBound.has(botId)) {
    entry.view.webContents.debugger.on("message", (_event, method, params) => {
      if (method !== "Runtime.bindingCalled" || params?.name !== "ombTeach" || !browserTeaching.has(botId)) return;
      try { browserTeaching.get(botId).push(JSON.parse(params.payload)); } catch {}
    });
    entry.view.webContents.on("did-navigate", (_event, url) => browserTeaching.get(botId)?.push({ action: "navigate", url, at: Date.now() }));
    teachDebuggerBound.add(botId);
  }
  return true;
}

async function cdp(view, method, params = {}) {
  if (!view.webContents.debugger.isAttached()) view.webContents.debugger.attach("1.3");
  return view.webContents.debugger.sendCommand(method, params);
}

const BROWSER_KEYS = new Set(["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space"]);
const BROWSER_KEY_CODES = {
  Enter: { code: "Enter", keyCode: 13 }, Tab: { code: "Tab", keyCode: 9 }, Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 }, Space: { code: "Space", keyCode: 32 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 }, ArrowUp: { code: "ArrowUp", keyCode: 38 }, ArrowRight: { code: "ArrowRight", keyCode: 39 }, ArrowDown: { code: "ArrowDown", keyCode: 40 },
  PageUp: { code: "PageUp", keyCode: 33 }, PageDown: { code: "PageDown", keyCode: 34 }, End: { code: "End", keyCode: 35 }, Home: { code: "Home", keyCode: 36 },
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

async function browserState(view) {
  const wc = view.webContents;
  const metrics = await cdp(view, "Runtime.evaluate", {
    expression: "JSON.stringify({scrollX:window.scrollX,scrollY:window.scrollY,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,readyState:document.readyState})",
    returnByValue: true,
  }).catch(() => ({ result: { value: "{}" } }));
  let page = {};
  try { page = JSON.parse(metrics.result?.value ?? "{}"); } catch {}
  return {
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
    ...page,
  };
}

async function resolveBrowserRef(botId, view, ref) {
  const backendNodeId = browserRefs.get(botId)?.get(String(ref));
  if (!backendNodeId) throw Object.assign(new Error("Element ref is stale or unknown; take a fresh snapshot and retry"), { status: 409 });
  await cdp(view, "DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {});
  const box = await cdp(view, "DOM.getBoxModel", { backendNodeId }).catch(() => null);
  const quad = box?.model?.content ?? box?.model?.border;
  const { object } = await cdp(view, "DOM.resolveNode", { backendNodeId });
  if (!object?.objectId) throw Object.assign(new Error("Element changed; take a fresh snapshot and retry"), { status: 409 });
  return { backendNodeId, objectId: object.objectId, quad };
}

async function browserCommand(botId, action, input = {}) {
  botId = safeBotId(botId);
  if (!["navigate", "state", "snapshot", "screenshot", "click", "type", "press_key", "scroll", "wait"].includes(action)) throw Object.assign(new Error("unknown browser action"), { status: 400 });
  const entry = ensureBrowser(botId);
  const wc = entry.view.webContents;
  if (action === "navigate") {
    await browserNavigation.navigate(botId, wc, input.url);
    browserTeaching.get(botId)?.push({ action: "navigate", url: wc.getURL(), title: wc.getTitle(), at: Date.now() });
    return { url: wc.getURL(), title: wc.getTitle() };
  }
  if (action === "state") return browserState(entry.view);
  if (action === "snapshot") {
    await cdp(entry.view, "Accessibility.enable");
    const { nodes = [] } = await cdp(entry.view, "Accessibility.getFullAXTree");
    const refs = new Map();
    const lines = [];
    for (const node of nodes) {
      const role = node.role?.value;
      const name = node.name?.value;
      if (!role || role === "none" || role === "generic") continue;
      const ref = node.backendDOMNodeId ? `e${refs.size + 1}` : null;
      if (ref) refs.set(ref, node.backendDOMNodeId);
      const value = node.value?.value;
      lines.push(`${ref ? `[${ref}] ` : ""}${role}${name ? ` "${name}"` : ""}${value ? ` value="${String(value).slice(0, 120)}"` : ""}`);
      if (lines.length >= 300) break;
    }
    browserRefs.set(botId, refs);
    return { url: wc.getURL(), title: wc.getTitle(), snapshot: lines.join("\n") || "(no accessible elements)" };
  }
  if (action === "screenshot") {
    await cdp(entry.view, "Page.enable");
    const { data } = await cdp(entry.view, "Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    return { url: wc.getURL(), mime: "image/png", png: data };
  }
  if (action === "press_key") {
    const key = String(input.key ?? "");
    if (!BROWSER_KEYS.has(key)) throw Object.assign(new Error("unsupported key"), { status: 400 });
    const cdpKey = key === "Space" ? " " : key;
    const keyInfo = BROWSER_KEY_CODES[key];
    const params = { key: cdpKey, code: keyInfo.code, windowsVirtualKeyCode: keyInfo.keyCode, nativeVirtualKeyCode: keyInfo.keyCode };
    await cdp(entry.view, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...params });
    await cdp(entry.view, "Input.dispatchKeyEvent", { type: "keyUp", ...params });
    return browserState(entry.view);
  }
  if (action === "scroll") {
    const x = clamp(input.x, -5000, 5000);
    const y = clamp(input.y ?? 600, -5000, 5000);
    const state = await browserState(entry.view);
    await cdp(entry.view, "Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.max(1, Math.floor((state.viewportWidth ?? 1024) / 2)), y: Math.max(1, Math.floor((state.viewportHeight ?? 720) / 2)), deltaX: x, deltaY: y });
    const beforeX = state.scrollX ?? 0;
    const beforeY = state.scrollY ?? 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      await wait(25);
      const next = await browserState(entry.view);
      if (next.scrollX !== beforeX || next.scrollY !== beforeY || (x === 0 && y === 0)) return next;
    }
    return browserState(entry.view);
  }
  if (action === "wait") {
    const timeoutMs = clamp(input.timeoutMs ?? 8000, 100, 15_000);
    const deadline = Date.now() + timeoutMs;
    do {
      const state = await browserState(entry.view);
      if (typeof input.urlContains === "string" && state.url.includes(input.urlContains)) return { ok: true, matched: "url", ...state };
      if (input.load === true && !state.loading && state.readyState === "complete") return { ok: true, matched: "load", ...state };
      if (typeof input.text === "string" && input.text) {
        const found = await cdp(entry.view, "Runtime.evaluate", { expression: `document.body?.innerText?.includes(${JSON.stringify(input.text)}) === true`, returnByValue: true }).catch(() => null);
        if (found?.result?.value === true) return { ok: true, matched: "text", ...state };
      }
      if (typeof input.ref === "string" && browserRefs.get(botId)?.has(input.ref)) {
        try { await resolveBrowserRef(botId, entry.view, input.ref); return { ok: true, matched: "ref", ...state }; } catch {}
      }
      await wait(100);
    } while (Date.now() < deadline);
    throw Object.assign(new Error("wait condition timed out; inspect state and take a fresh snapshot"), { status: 408 });
  }
  const { objectId, quad } = await resolveBrowserRef(botId, entry.view, input.ref);
  if (action === "click") {
    if (!quad?.length) throw Object.assign(new Error("Element has no clickable bounds; take a fresh snapshot or use a different element"), { status: 409 });
    const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
    const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
    await cdp(entry.view, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp(entry.view, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    browserTeaching.get(botId)?.push({ action: "click", ref: String(input.ref), url: wc.getURL(), at: Date.now() });
    return { ok: true, ...(await browserState(entry.view)) };
  }
  if (action === "type") {
    const text = String(input.text ?? "");
    if (text.length > 100_000) throw Object.assign(new Error("text is too long"), { status: 413 });
    await cdp(entry.view, "Runtime.callFunctionOn", { objectId, functionDeclaration: "function(){ this.focus(); if ('value' in this) { this.value = ''; this.dispatchEvent(new Event('input',{bubbles:true})); } }" });
    await cdp(entry.view, "Input.insertText", { text });
    await cdp(entry.view, "Runtime.callFunctionOn", { objectId, functionDeclaration: "function(){ this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }" });
    // Never retain the typed value: it may be a password or another secret.
    browserTeaching.get(botId)?.push({ action: "type", ref: String(input.ref), value: "<input>", url: wc.getURL(), at: Date.now() });
    return { ok: true, ...(await browserState(entry.view)) };
  }
  throw new Error(`Unknown browser action: ${action}`);
}

async function startBrowserBridge() {
  browserBridge = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${BROWSER_TOKEN}`) throw Object.assign(new Error("unauthorized"), { status: 401 });
      if (req.method !== "POST") throw Object.assign(new Error("method not allowed"), { status: 405 });
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1_000_000) throw Object.assign(new Error("request too large"), { status: 413 });
      }
      const input = body ? JSON.parse(body) : {};
      const result = await browserCommand(String(input.botId ?? ""), String(input.action ?? ""), input);
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(error?.status ?? 500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: error?.message ?? String(error) }));
    }
  });
  await new Promise((resolve, reject) => { browserBridge.once("error", reject); browserBridge.listen(0, "127.0.0.1", resolve); });
  const address = browserBridge.address();
  fs.writeFileSync(
    path.join(app.getPath("userData"), "browser-connection.json"),
    JSON.stringify({ url: `http://127.0.0.1:${address.port}`, token: BROWSER_TOKEN }, null, 2),
    { mode: 0o600 },
  );
  fs.chmodSync(path.join(app.getPath("userData"), "browser-connection.json"), 0o600);
}
async function startServerOn(port) {
  const entry = path.join(process.resourcesPath, "server", "index.js");
  const proc = utilityProcess.fork(entry, [], {
    env: {
      ...process.env,
      OMB_STATIC_DIR: path.join(process.resourcesPath, "ui"),
      OMB_PORT: String(port),
      OMB_GH_CLI: path.join(process.resourcesPath, "github-cli", "gh"),
      OMB_KEYCHAIN_HELPER: path.join(process.resourcesPath, "keychain-helper"),
      OMB_APP_TOKEN: APP_TOKEN,
    },
    stdio: "inherit",
  });
  let exited = false;
  proc.once("exit", () => {
    exited = true;
  });
  // wait for the port to answer (fresh machine: first boot writes data dirs).
  // Identity check is by PID: a dev harness server has the same API shape,
  // so only the child we actually forked (matching pid + static serving)
  // counts as ours.
  for (let i = 0; i < 40; i++) {
    if (exited) return null;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.app === "openmausbot" && body.pid === proc.pid && body.static) return proc;
        break; // someone else owns this port — try the next one
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    proc.kill();
  } catch {}
  return null;
}

async function startServerPackaged() {
  // two passes: a quit-and-reopen relaunch can race the dying instance's
  // server during teardown — one settle-and-retry covers it
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const port of [8799, 18799, 28799]) {
      const proc = await startServerOn(port);
      if (proc) {
        serverProc = proc;
        SERVER_PORT = port;
        return true;
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}

const ERROR_PAGE =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#070707;color:#fcfcfc;font:15px -apple-system,system-ui"><div style="text-align:center;max-width:360px"><div style="font-size:40px">🐭</div><h2 style="font-weight:600;margin:12px 0 6px">Couldn't start the bot server</h2><p style="color:#fcfcfc99;line-height:1.5">Something else is using its ports. Quit and reopen OpenMausBot — if it keeps happening, restart your Mac.</p></div></body>`,
  );

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    icon: APP_ICON,
    backgroundColor: "#070707",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (app.isPackaged) {
    win.loadURL(serverReady ? `http://127.0.0.1:${SERVER_PORT}` : ERROR_PAGE);
  } else {
    win.loadURL(DEV_URL);
  }
  mainWindow = win;
  win.webContents.on("render-process-gone", (_event, details) => recordCrash("renderer-process", `${details.reason}:${details.exitCode}`));
  return win;
}

ipcMain.handle("notification:show", (event, input) => {
  assertMainRenderer(event);
  if (!Notification.isSupported()) return false;
  const notification = new Notification({
    title: String(input?.title ?? "OpenMausBot").slice(0, 120),
    body: String(input?.body ?? "").slice(0, 500),
    silent: false,
  });
  notification.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });
  notification.show();
  return true;
});

// "This Mac" screen preview — served from the main process so the Screen
// Recording permission prompt attributes to the app, never the server
ipcMain.handle("screen:frame", async (event) => {
  assertMainRenderer(event);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1280, height: 800 },
  });
  return sources[0]?.thumbnail.toDataURL() ?? null;
});

// Onboarding permission checks. Status reads are free; the mic request
// pops the real TCC prompt attributed to the app.
//
// Screen Recording deliberately has NO request path here. On macOS 15+
// every pre-grant mechanism is broken: getMediaAccessStatus("screen")
// wraps CGPreflightScreenCaptureAccess, which caches per-process (stays
// "denied" for the whole session after the user grants); a helper child
// binary gets TCC-attributed to ITSELF on macOS 26, not the app, and
// plain executables no longer appear in the Settings pane at all; and
// Sequoia+ re-prompts periodically regardless, so a pre-grant expires.
// The one reliable path is the first real in-process capture
// (screen:frame above / getDisplayMedia via the handler below) — macOS
// prompts then, attributed correctly, at the moment of actual use. The
// perm:open-settings deep link stays as the repair path for denials.
ipcMain.handle("perm:status", (event) => {
  assertMainRenderer(event);
  return ({
  mic: systemPreferences.getMediaAccessStatus?.("microphone") ?? "unknown",
  });
});
ipcMain.handle("perm:request-mic", async (event) => {
  assertMainRenderer(event);
  try {
    return await systemPreferences.askForMediaAccess("microphone");
  } catch {
    return false;
  }
});

// macOS never re-prompts a denied permission — the only path is System
// Settings; deep-link straight to the right privacy pane.
ipcMain.handle("perm:open-settings", (event, pane) => {
  assertMainRenderer(event);
  const panes = {
    mic: "Privacy_Microphone",
    screen: "Privacy_ScreenCapture",
    speech: "Privacy_SpeechRecognition",
  };
  return shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${panes[pane] ?? "Privacy"}`,
  );
});

ipcMain.handle("speech:start", (event) => {
  assertMainRenderer(event);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) startSpeech(win);
});
ipcMain.handle("speech:stop", (event) => { assertMainRenderer(event); return stopSpeech(); });

ipcMain.handle("browser:show", async (event, { botId, url, bounds }) => {
  assertMainRenderer(event);
  const id = safeBotId(botId);
  const entry = ensureBrowser(id, event.sender);
  entry.view.setBounds(safeBrowserBounds(bounds));
  entry.view.setVisible(true);
  return url ? browserNavigation.show(id, entry.view.webContents, url) : { url: entry.view.webContents.getURL(), title: entry.view.webContents.getTitle() };
});
ipcMain.handle("browser:navigate", async (event, { botId, url }) => {
  assertMainRenderer(event);
  const id = safeBotId(botId);
  const entry = ensureBrowser(id, event.sender);
  return browserNavigation.navigate(id, entry.view.webContents, url);
});
ipcMain.handle("browser:action", (event, { botId, action }) => {
  assertMainRenderer(event);
  const entry = ensureBrowser(String(botId), event.sender);
  if (action === "back" && entry.view.webContents.canGoBack()) entry.view.webContents.goBack();
  if (action === "forward" && entry.view.webContents.canGoForward()) entry.view.webContents.goForward();
  if (action === "reload") entry.view.webContents.reload();
  return { url: entry.view.webContents.getURL() };
});
ipcMain.handle("browser:hide", (event, botId) => {
  assertMainRenderer(event);
  browserViews.get(String(botId))?.view.setVisible(false);
});
ipcMain.handle("browser:teach-start", (event, botId) => { assertMainRenderer(event); return startTeaching(String(botId)); });
ipcMain.handle("browser:teach-stop", (event, botId) => { assertMainRenderer(event); const id = String(botId); const steps = browserTeaching.get(id) ?? []; browserTeaching.delete(id); return { steps }; });

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock.setIcon(APP_ICON);
  // getDisplayMedia in the renderer → this handler → ScreenCaptureKit, all
  // inside the app's own processes — the one capture path macOS reliably
  // attributes to the app (registers it in the Screen Recording pane and
  // prompts). Used by the onboarding "Enable screen preview" button.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
  registerCuaIpc(assertMainRenderer);
  registerUpdaterIpc(assertMainRenderer);
  // Start the CUA daemon before the window so the harness can pick up the
  // connection descriptor on first render. Never blocks window creation on
  // failure — computer use degrades to "unavailable", the rest still works.
  await startCua().catch((e) => console.error("[cua] start failed:", e));
  // The packaged harness reads browser-connection.json during turns. Make
  // the bridge descriptor available before starting that child process.
  await startBrowserBridge().catch((e) => console.error("[browser] bridge failed:", e));
  if (app.isPackaged) {
    serverReady = await startServerPackaged();
    if (serverReady) {
      await session.defaultSession.cookies.set({
        url: `http://127.0.0.1:${SERVER_PORT}`,
        name: "omb_session",
        value: APP_TOKEN,
        httpOnly: true,
        sameSite: "strict",
      });
    }
  }
  const win = createWindow();
  // in-app auto-update (packaged only) — checks GitHub releases, downloads on
  // the user's click, installs on "Restart to update"
  startUpdater(win);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// EMBEDDING.md lifecycle rule: defer the first quit until the embedded
// daemon's async cleanup completes — it can't run after the host exits.
let cuaCleanedUp = false;
app.on("before-quit", (e) => {
  if (cuaCleanedUp) return;
  e.preventDefault();
  for (const { view } of browserViews.values()) view.webContents.close();
  browserViews.clear();
  browserBridge?.close();
  try {
    serverProc?.kill();
  } catch {}
  stopCua().finally(() => {
    cuaCleanedUp = true;
    app.quit();
  });
});
