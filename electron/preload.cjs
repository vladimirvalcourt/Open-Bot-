// Renderer bridge. contextIsolation stays on; the renderer only ever sees
// this narrow surface (window.ogb), never Node or ipcRenderer itself.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ogb", {
  /** One frame of this Mac's screen as a data: URL (Screen Recording TCC). */
  screenFrame: () => ipcRenderer.invoke("screen:frame"),
  speechStart: () => ipcRenderer.invoke("speech:start"),
  speechStop: () => ipcRenderer.invoke("speech:stop"),
  onSpeechTranscript: (cb) => {
    const handler = (_event, line) => cb(line);
    ipcRenderer.on("speech:transcript", handler);
    return () => ipcRenderer.removeListener("speech:transcript", handler);
  },
  onSpeechEnd: (cb) => {
    const handler = (_event, info) => cb(info);
    ipcRenderer.on("speech:end", handler);
    return () => ipcRenderer.removeListener("speech:end", handler);
  },
  /** {mic} TCC status strings: granted|denied|not-determined|unknown.
   * No screen field — macOS 15+ caches that status per-process, so any
   * value here would lie for the whole session after a grant. */
  permStatus: () => ipcRenderer.invoke("perm:status"),
  /** Triggers the macOS microphone prompt; resolves true when granted. */
  permRequestMic: () => ipcRenderer.invoke("perm:request-mic"),
  /** Opens System Settings on the given privacy pane: mic|screen|speech. */
  permOpenSettings: (pane) => ipcRenderer.invoke("perm:open-settings", pane),

  /** Local computer-use permissions and daemon lifecycle. */
  cua: {
    status: () => ipcRenderer.invoke("cua:permissions"),
    requestPermissions: () => ipcRenderer.invoke("cua:request-permissions"),
    openSettings: (pane) => ipcRenderer.invoke("cua:open-settings", pane),
    restart: () => ipcRenderer.invoke("cua:restart"),
  },
  browser: {
    show: (botId, url, bounds) => ipcRenderer.invoke("browser:show", { botId, url, bounds }),
    navigate: (botId, url) => ipcRenderer.invoke("browser:navigate", { botId, url }),
    action: (botId, action) => ipcRenderer.invoke("browser:action", { botId, action }),
    hide: (botId) => ipcRenderer.invoke("browser:hide", botId),
    teachStart: (botId) => ipcRenderer.invoke("browser:teach-start", botId),
    teachStop: (botId) => ipcRenderer.invoke("browser:teach-stop", botId),
  },
  notifications: {
    show: (title, body) => ipcRenderer.invoke("notification:show", { title, body }),
  },

  /** In-app auto-update. State object:
   *  { status: "idle"|"checking"|"available"|"downloading"|"downloaded"|"error",
   *    version?, percent?, message? }. onState fires immediately with the
   *    current state, then on every transition. Dormant in dev (no bridge). */
  updater: {
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    onState: (cb) => {
      ipcRenderer
        .invoke("update:get-state")
        .then((s) => cb(s))
        .catch(() => {});
      const handler = (_event, s) => cb(s);
      ipcRenderer.on("update:state", handler);
      return () => ipcRenderer.removeListener("update:state", handler);
    },
  },
});
