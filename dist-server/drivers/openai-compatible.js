import { newEventId, newId } from "../contracts.js";
import { appendNative } from "./native.js";
const DRIVER_KIND = "openaiCompatible";
function decodeConfig(raw) {
    const value = (raw ?? {});
    const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim().replace(/\/+$/, "") : "";
    const model = typeof value.model === "string" ? value.model.trim() : "";
    if (!baseUrl || !model)
        throw new Error("API provider needs a base URL and model");
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))) {
        throw new Error("API provider URL must use HTTPS (HTTP is allowed only for local models)");
    }
    return { baseUrl, model };
}
export const OpenAiCompatibleDriver = {
    driverKind: DRIVER_KIND,
    metadata: { displayName: "API Provider", supportsMultipleInstances: true },
    models: { default: "", options: [] },
    decodeConfig,
    defaultConfig: () => {
        throw new Error("API provider needs configuration");
    },
    async create(input) {
        const { instanceId, config } = input;
        const apiKey = input.environment.API_KEY ?? "";
        const models = { default: config.model, options: [{ id: config.model, label: config.model }] };
        const listeners = new Set();
        const active = new Map();
        const emit = (event) => listeners.forEach((listener) => listener(event));
        const base = (threadId, turnId) => ({
            eventId: newEventId(), provider: DRIVER_KIND, threadId, turnId, createdAt: new Date().toISOString(),
        });
        const complete = async (messages, model, options) => {
            const response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: "POST",
                headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
                // Keep the request at the common Chat Completions denominator. Several
                // otherwise-compatible providers reject OpenAI's optional
                // `stream_options` field.
                body: JSON.stringify({ model, messages, stream: options.stream }),
                signal: options.signal ?? AbortSignal.timeout(120_000),
            });
            if (!response.ok) {
                const body = await response.text().catch(() => "");
                throw new Error(`${input.displayName ?? "provider"} HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
            }
            if (!options.stream) {
                const json = await response.json();
                return {
                    text: json.choices?.[0]?.message?.content ?? "",
                    usage: json.usage ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 } : null,
                };
            }
            let text = "";
            let usage = null;
            const reader = response.body?.getReader();
            if (!reader)
                throw new Error("provider returned no response stream");
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                let newline;
                while ((newline = buffer.indexOf("\n")) !== -1) {
                    const line = buffer.slice(0, newline).trim();
                    buffer = buffer.slice(newline + 1);
                    if (!line.startsWith("data:"))
                        continue;
                    const data = line.slice(5).trim();
                    if (!data || data === "[DONE]")
                        continue;
                    let chunk;
                    try {
                        chunk = JSON.parse(data);
                    }
                    catch {
                        continue;
                    }
                    const delta = chunk.choices?.[0]?.delta?.content;
                    if (typeof delta === "string" && delta) {
                        text += delta;
                        options.onDelta?.(delta);
                    }
                    if (chunk.usage)
                        usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 };
                }
            }
            return { text, usage };
        };
        const sendTurn = async (turn) => {
            if (!apiKey)
                throw new Error("API key is missing");
            if (active.has(turn.threadId))
                throw new Error("a turn is already running on this thread");
            const turnId = newId();
            const abort = new AbortController();
            active.set(turn.threadId, { abort, turnId });
            const messages = [
                ...(turn.system ? [{ role: "system", content: turn.system }] : []),
                ...(turn.transcript ?? []).map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.text })),
                { role: "user", content: turn.text },
            ];
            const model = turn.model || config.model;
            appendNative(turn.threadId, { dir: "out", source: "openai-compatible.chat.completions", msg: { model, messages } });
            emit({ ...base(turn.threadId, turnId), type: "turn.started" });
            emit({ ...base(turn.threadId, turnId), type: "session.started", sessionId: null, model });
            void (async () => {
                try {
                    const result = await complete(messages, model, {
                        stream: true,
                        signal: abort.signal,
                        onDelta: (delta) => emit({ ...base(turn.threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta }),
                    });
                    appendNative(turn.threadId, { dir: "in", source: "openai-compatible.chat.completions", msg: result });
                    if (result.text.trim())
                        emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "assistant_text", text: result.text });
                    if (result.usage)
                        emit({ ...base(turn.threadId, turnId), type: "thread.token-usage.updated", ...result.usage });
                    emit({ ...base(turn.threadId, turnId), type: "turn.completed", ok: true, stopReason: null, cost: null });
                }
                catch (error) {
                    const aborted = error.name === "AbortError";
                    if (!aborted)
                        emit({ ...base(turn.threadId, turnId), type: "runtime.error", message: error.message });
                    emit({ ...base(turn.threadId, turnId), type: "turn.completed", ok: false, stopReason: aborted ? "interrupted" : "error", cost: null });
                }
                finally {
                    active.delete(turn.threadId);
                }
            })();
            return { turnId };
        };
        return {
            instanceId, driverKind: DRIVER_KIND, displayName: input.displayName, enabled: input.enabled, models,
            snapshot: async () => apiKey
                ? { state: "available", authenticated: true, version: null }
                : { state: "unavailable", reason: "API key is missing" },
            adapter: {
                provider: DRIVER_KIND,
                capabilities: { sessionModelSwitch: "in-session" },
                sendTurn,
                interruptTurn: async (threadId) => active.get(threadId)?.abort.abort(),
                respondToRequest: async () => { throw new Error("API provider has no pending requests"); },
                hasSession: (threadId) => active.has(threadId),
                stopAll: async () => active.forEach(({ abort }) => abort.abort()),
                onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
            },
            generateText: async (prompt) => (await complete([{ role: "user", content: prompt }], config.model, { stream: false })).text,
            dispose: async () => { active.forEach(({ abort }) => abort.abort()); listeners.clear(); },
        };
    },
};
