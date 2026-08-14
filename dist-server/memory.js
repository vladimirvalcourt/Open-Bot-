import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.js";
import { newId } from "./contracts.js";
const FILE = join(DATA_DIR, "memory.json");
export class MemoryStore {
    items = [];
    constructor() { mkdirSync(DATA_DIR, { recursive: true }); try {
        const value = JSON.parse(readFileSync(FILE, "utf8"));
        this.items = Array.isArray(value) ? value : [];
    }
    catch { } }
    save() { const temp = `${FILE}.tmp`; writeFileSync(temp, JSON.stringify(this.items, null, 2), { mode: 0o600 }); renameSync(temp, FILE); try {
        chmodSync(FILE, 0o600);
    }
    catch { } }
    relevant(botId) { return this.items.filter((item) => item.scope === "shared" || item.botId === botId).slice(0, 100); }
    search(botId, query, limit = 20) {
        const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
        const candidates = this.relevant(botId);
        if (!terms.length)
            return candidates.slice(0, limit);
        return candidates
            .map((item) => {
            const text = `${item.kind} ${item.text}`.toLowerCase();
            const score = terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
            return { item, score };
        })
            .filter((entry) => entry.score > 0)
            .sort((left, right) => right.score - left.score || right.item.updatedAt - left.item.updatedAt)
            .slice(0, Math.min(50, Math.max(1, limit)))
            .map((entry) => entry.item);
    }
    create(input) { const now = Date.now(); const item = { id: newId(), createdAt: now, updatedAt: now, ...input }; this.items.unshift(item); this.save(); return item; }
    patch(id, patch) { const item = this.items.find((value) => value.id === id); if (!item)
        return null; Object.assign(item, patch, { updatedAt: Date.now() }); this.save(); return item; }
    delete(id) { const length = this.items.length; this.items = this.items.filter((item) => item.id !== id); if (length !== this.items.length)
        this.save(); return length !== this.items.length; }
}
