import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface LaunchedApp { app: ElectronApplication; page: Page; dataDir: string; userDataDir: string; services: ChildProcess[] }

async function waitForUrl(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`service did not start: ${url}`);
}

export async function launchOpenMausBot(): Promise<LaunchedApp> {
  const userDataDir = await mkdtemp(join(tmpdir(), "omb-e2e-electron-"));
  const dataDir = await mkdtemp(join(tmpdir(), "omb-e2e-data-"));
  await writeFile(join(dataDir, "config.json"), JSON.stringify({ profile: { name: "E2E", email: "" } }));
  const harness = spawn(process.execPath, [resolve("server/index.ts")], {
    env: {
      ...process.env,
      OMB_DATA_DIR: dataDir,
      OMB_PORT: "39799",
      OMB_ALLOWED_ORIGIN: "http://127.0.0.1:35199",
    },
    stdio: "ignore",
  });
  const vite = spawn(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "35199"], {
    // The Vite proxy reads the per-boot harness token from OMB_DATA_DIR.
    // Keep that path aligned with the isolated test harness instead of the
    // developer's real ~/.openmausbot directory.
    env: { ...process.env, OGB_PORT: "39799", OMB_DATA_DIR: dataDir }, stdio: "ignore",
  });
  await waitForUrl("http://127.0.0.1:39799/api/health");
  await waitForUrl("http://127.0.0.1:35199/");
  const app = await electron.launch({
    args: [resolve(".")],
    env: {
      ...process.env,
      OMB_DATA_DIR: dataDir,
      ELECTRON_START_URL: "http://127.0.0.1:35199",
      OMB_E2E_USER_DATA: userDataDir,
    },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.readyState !== "loading" && location.href !== "about:blank", undefined, { timeout: 30_000 });
  return { app, page, dataDir, userDataDir, services: [vite, harness] };
}

export async function closeOpenMausBot(launched: LaunchedApp) {
  const appProcess = launched.app.process();
  let fallback: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    launched.app.close(),
    new Promise<void>((resolvePromise) => {
      fallback = setTimeout(() => {
        if (!appProcess.killed) appProcess.kill();
        resolvePromise();
      }, 10_000);
    }),
  ]);
  if (fallback) clearTimeout(fallback);
  for (const service of launched.services) service.kill("SIGTERM");
}
