// MCP proxy for the current bot's GitHub Codespace. The GitHub credential is
// received only through the child environment and never appears in renderer
// state, tool results, or command arguments.
import { spawn } from "node:child_process";
import readline from "node:readline";
const gh = process.env.OMB_GH_CLI || "gh";
const codespace = process.env.OMB_CODESPACE_NAME || "";
const token = process.env.OMB_CODESPACES_TOKEN || "";
const validName = /^[A-Za-z0-9-]+$/;
const TOOLS = [
    {
        name: "computer_exec",
        description: "Run a shell command on this bot's isolated GitHub Codespace. Browser work belongs in the separate embedded-browser tools.",
        inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    },
    {
        name: "computer_state",
        description: "Check that the GitHub Codespace is reachable and identify its Linux environment.",
        inputSchema: { type: "object", properties: {} },
    },
];
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const result = (id, text, isError = false) => send({
    jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) },
});
function run(command, timeoutMs = 120_000) {
    return new Promise((resolveRun, reject) => {
        if (!token || !validName.test(codespace))
            return reject(new Error("Codespaces integration is not configured"));
        const child = spawn(gh, ["codespace", "ssh", "--codespace", codespace, "--", "-T", command.slice(0, 4000)], {
            env: { ...process.env, GH_TOKEN: token, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Codespace command timed out")); }, timeoutMs);
        timer.unref?.();
        child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 1_000_000)
            child.kill("SIGTERM"); });
        child.stderr.on("data", (chunk) => { stderr += chunk; if (stderr.length > 1_000_000)
            child.kill("SIGTERM"); });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", (code) => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
    });
}
async function handle(message) {
    const { id, method } = message;
    if (method === "initialize")
        return send({ jsonrpc: "2.0", id, result: { protocolVersion: message.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "openmausbot-codespaces", version: "1" } } });
    if (String(method ?? "").startsWith("notifications/"))
        return;
    if (method === "tools/list")
        return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (method === "tools/call") {
        const name = message.params?.name;
        if (!TOOLS.some((tool) => tool.name === name))
            return result(id, `Unknown tool: ${name}`, true);
        try {
            const command = name === "computer_state"
                ? "printf 'codespace=%s\\n' \"$CODESPACE_NAME\"; uname -a; pwd"
                : String(message.params?.arguments?.command ?? "");
            if (!command)
                return result(id, "computer_exec requires a command", true);
            const output = await run(command);
            return result(id, `exit ${output.code}\n${output.stdout.slice(-6000)}${output.stderr ? `\n[stderr]\n${output.stderr.slice(-2000)}` : ""}`, output.code !== 0);
        }
        catch (error) {
            return result(id, error instanceof Error ? error.message : String(error), true);
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
