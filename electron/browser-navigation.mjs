// Coordinate embedded-browser loads. Layout changes can call browser:show
// repeatedly while a page is loading; Electron reports the cancelled duplicate
// as ERR_ABORTED. Keep one load per bot/target and serialize real changes.
export function safeBrowserUrl(value) {
  const raw = String(value || "about:blank").trim();
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(candidate);
  if (url.href === "about:blank") return url.href;
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https URLs are allowed");
  return url.href;
}

function isAbortedNavigation(error) {
  return error?.code === -3 || error?.errno === -3 || /ERR_ABORTED|\(-3\)/.test(String(error?.message ?? error));
}

export class BrowserNavigationCoordinator {
  #pending = new Map();

  async navigate(key, webContents, value) {
    const target = safeBrowserUrl(value);
    if (webContents.getURL() === target) return this.#result(webContents);
    const active = this.#pending.get(key);
    if (active?.target === target) return active.promise;

    const operation = (active?.promise ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (webContents.isDestroyed?.()) throw new Error("embedded browser was closed");
        if (webContents.getURL() !== target) {
          try {
            await webContents.loadURL(target);
          } catch (error) {
            // Navigation replacement is normal when a site redirects or the
            // user/agent changes destination while a load is in progress.
            if (!isAbortedNavigation(error)) throw error;
          }
        }
        return this.#result(webContents);
      });

    const record = { target, promise: operation };
    this.#pending.set(key, record);
    void operation.finally(() => {
      if (this.#pending.get(key) === record) this.#pending.delete(key);
    }).catch(() => {});
    return operation;
  }

  async show(key, webContents, value) {
    const current = webContents.getURL();
    // Resizing is not navigation. Seed a blank view once, but preserve the
    // actual page after the user or agent browses elsewhere.
    if (!current || current === "about:blank") return this.navigate(key, webContents, value);
    return this.#result(webContents);
  }

  #result(webContents) {
    return { url: webContents.getURL(), title: webContents.getTitle() };
  }
}
