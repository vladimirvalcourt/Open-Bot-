// Minimal stdio-to-HTTP MCP bridge so every CLI driver can use the same
// connected-app gateway, including ACP clients that only accept stdio MCP.
import { createInterface } from "node:readline";
const url = process.env.OMB_MCP_URL ?? "";
let headers = {};
try {
    headers = JSON.parse(process.env.OMB_MCP_HEADERS ?? "{}");
}
catch { }
if (!url)
    process.exit(2);
const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
    let message;
    try {
        message = JSON.parse(line);
    }
    catch {
        return;
    }
    try {
        const response = await fetch(url, { method: "POST", headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(message) });
        const body = await response.text();
        if (!response.ok)
            throw new Error(`MCP HTTP ${response.status}`);
        const frames = response.headers.get("content-type")?.includes("text/event-stream")
            ? body.split("\n").filter((value) => value.startsWith("data:")).map((value) => value.slice(5).trim())
            : [body];
        for (const frame of frames)
            if (frame)
                process.stdout.write(frame + "\n");
    }
    catch (error) {
        const id = message?.id;
        if (id !== undefined)
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }) + "\n");
    }
});
