import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "browser-proxy.ts");
let proxy: ChildProcess | null = null;
let bridge: Server | null = null;

afterEach(async () => {
  proxy?.kill(); proxy = null;
  await new Promise<void>((resolve) => bridge?.close(() => resolve()) ?? resolve()); bridge = null;
});

function rpc(child: ChildProcess, message: object) {
  return new Promise<any>((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      child.stdout!.off("data", onData);
      try { resolve(JSON.parse(buffer.slice(0, newline))); } catch (error) { reject(error); }
    };
    child.stdout!.on("data", onData);
    child.stdin!.write(JSON.stringify(message) + "\n");
  });
}

describe.skipIf(process.platform === "win32")("browser MCP proxy", () => {
  it("lists tools and forwards a bot-scoped authenticated snapshot", async () => {
    let received: any;
    bridge = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      received = { auth: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ snapshot: '[e1] button "Continue"' }));
    });
    await new Promise<void>((resolve) => bridge!.listen(0, "127.0.0.1", resolve));
    const address = bridge.address();
    proxy = spawn(process.execPath, [PROXY], {
      env: { ...process.env, OMB_BROWSER_URL: `http://127.0.0.1:${(address as any).port}`, OMB_BROWSER_TOKEN: "secret", OMB_BOT_ID: "bot-7" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const listed = await rpc(proxy, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "navigate", "state", "snapshot", "click", "type", "press_key", "scroll", "wait", "screenshot",
    ]);
    const called = await rpc(proxy, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "snapshot", arguments: {} } });
    expect(called.result.content[0].text).toContain("Continue");
    expect(received).toEqual({ auth: "Bearer secret", body: { botId: "bot-7", action: "snapshot" } });
  });
});
