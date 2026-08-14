import readline from "node:readline";
const URL = process.env.OMB_BROWSER_URL ?? "";
const TOKEN = process.env.OMB_BROWSER_TOKEN ?? "";
const BOT_ID = process.env.OMB_BOT_ID ?? "";
const TOOLS = [
    { name: "navigate", description: "Open an http or https URL in this bot's isolated embedded browser.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
    { name: "state", description: "Read URL, title, loading state, viewport size, scroll position, and navigation availability. Use this to verify page changes.", inputSchema: { type: "object", properties: {} } },
    { name: "snapshot", description: "Read the current page as an accessibility snapshot. Returns refs such as e1, e2. Refs expire after page changes; take a fresh snapshot before each action.", inputSchema: { type: "object", properties: {} } },
    { name: "click", description: "Scroll an element ref into view and perform a trusted pointer click. Take a fresh snapshot afterward to verify the result.", inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] } },
    { name: "type", description: "Focus an editable element ref, clear it, and type text.", inputSchema: { type: "object", properties: { ref: { type: "string" }, text: { type: "string" } }, required: ["ref", "text"] } },
    { name: "press_key", description: "Press a navigation/editing key in the page (Enter, Tab, Escape, Backspace, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space).", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
    { name: "scroll", description: "Scroll the page by a bounded number of pixels; positive y scrolls down and negative y scrolls up.", inputSchema: { type: "object", properties: { y: { type: "number" }, x: { type: "number" } } } },
    { name: "wait", description: "Wait up to 15 seconds for a URL fragment, visible page text, element ref, or page load completion. Use after actions that trigger asynchronous changes.", inputSchema: { type: "object", properties: { urlContains: { type: "string" }, text: { type: "string" }, ref: { type: "string" }, load: { type: "boolean" }, timeoutMs: { type: "number" } } } },
    { name: "screenshot", description: "Capture the visible embedded browser page as a PNG image.", inputSchema: { type: "object", properties: {} } },
];
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, message) => ok(id, { content: [{ type: "text", text: message }], isError: true });
async function call(action, input) {
    const response = await fetch(URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ botId: BOT_ID, action, ...input }),
    });
    const result = await response.json();
    if (!response.ok)
        throw new Error(result.error ?? `browser bridge HTTP ${response.status}`);
    if (action === "screenshot") {
        return { content: [{ type: "image", data: result.png, mimeType: result.mime ?? "image/png" }] };
    }
    return { content: [{ type: "text", text: result.snapshot ?? JSON.stringify(result) }] };
}
async function handle(message) {
    const { id, method } = message;
    if (!method)
        return;
    const params = message.params ?? {};
    if (method === "initialize")
        return ok(id, { protocolVersion: params.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "openmausbot-browser", version: "1" } });
    if (method === "notifications/initialized" || method === "notifications/cancelled")
        return;
    if (method === "ping")
        return ok(id, {});
    if (method === "tools/list")
        return ok(id, { tools: TOOLS });
    if (method === "tools/call") {
        if (!TOOLS.some((tool) => tool.name === params.name))
            return fail(id, `Unknown browser tool: ${params.name}`);
        try {
            return ok(id, await call(params.name, params.arguments ?? {}));
        }
        catch (error) {
            return fail(id, error instanceof Error ? error.message : String(error));
        }
    }
    if (id !== undefined)
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}
readline.createInterface({ input: process.stdin, terminal: false }).on("line", (line) => {
    try {
        void handle(JSON.parse(line));
    }
    catch { }
});
