import { describe, expect, it, vi } from "vitest";
import { BrowserNavigationCoordinator, safeBrowserUrl } from "./browser-navigation.mjs";

function fakeBrowser() {
  let url = "";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const webContents = {
    getURL: () => url,
    getTitle: () => "Page",
    isDestroyed: () => false,
    loadURL: vi.fn(async (next: string) => { await gate; url = next; }),
  };
  return { webContents, release, setUrl: (next: string) => { url = next; } };
}

describe("embedded browser navigation", () => {
  it("normalizes web URLs and rejects privileged schemes", () => {
    expect(safeBrowserUrl("example.com")).toBe("https://example.com/");
    expect(safeBrowserUrl("about:blank")).toBe("about:blank");
    expect(() => safeBrowserUrl("file:///etc/passwd")).toThrow(/http and https/);
    expect(() => safeBrowserUrl("javascript:alert(1)")).toThrow(/http and https/);
  });

  it("deduplicates repeated show calls during the initial load", async () => {
    const browser = fakeBrowser();
    const navigation = new BrowserNavigationCoordinator();
    const first = navigation.show("bot-1", browser.webContents, "https://www.google.com/");
    const second = navigation.show("bot-1", browser.webContents, "https://www.google.com/");
    await Promise.resolve();
    await Promise.resolve();
    expect(browser.webContents.loadURL).toHaveBeenCalledTimes(1);
    browser.release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("does not navigate an existing page when the panel resizes", async () => {
    const browser = fakeBrowser();
    browser.setUrl("https://example.com/account");
    const navigation = new BrowserNavigationCoordinator();
    await expect(navigation.show("bot-1", browser.webContents, "https://www.google.com/")).resolves.toMatchObject({ url: "https://example.com/account" });
    expect(browser.webContents.loadURL).not.toHaveBeenCalled();
  });
});
