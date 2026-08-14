import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import { DATA_DIR } from "./config.ts";
import { newId } from "./contracts.ts";

export interface Attachment { id: string; name: string; mime: string; size: number; createdAt: number }
export interface StoredAttachment extends Attachment { path: string }
const DIR = join(DATA_DIR, "attachments");
const META = join(DIR, "index.json");
const ALLOWED = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".md", ".csv", ".tsv", ".json", ".js", ".ts", ".tsx", ".py", ".docx", ".xlsx", ".pptx", ".mp3", ".wav", ".m4a"]);

export class AttachmentStore {
  private items: StoredAttachment[] = [];
  constructor() { mkdirSync(DIR, { recursive: true, mode: 0o700 }); try { const value = JSON.parse(readFileSync(META, "utf8")); this.items = Array.isArray(value) ? value : []; } catch {} }
  private saveIndex() { const tmp = `${META}.tmp`; writeFileSync(tmp, JSON.stringify(this.items, null, 2), { mode: 0o600 }); renameSync(tmp, META); try { chmodSync(META, 0o600); } catch {} }
  save(input: { name: string; mime: string; base64: string }): Attachment {
    const name = basename(input.name).replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180);
    if (!name || !ALLOWED.has(extname(name).toLowerCase())) throw Object.assign(new Error("unsupported attachment type"), { status: 400 });
    const data = Buffer.from(input.base64, "base64");
    if (!data.length || data.length > 20 * 1024 * 1024) throw Object.assign(new Error("attachment must be between 1 byte and 20 MB"), { status: 413 });
    const id = newId(); const path = join(DIR, `${id}-${name}`);
    writeFileSync(path, data, { mode: 0o600 }); try { chmodSync(path, 0o600); } catch {}
    const item: StoredAttachment = { id, name, mime: String(input.mime || "application/octet-stream").slice(0, 120), size: data.length, path, createdAt: Date.now() };
    this.items.unshift(item); this.saveIndex();
    return this.public(item);
  }
  resolve(ids: unknown): StoredAttachment[] {
    if (!Array.isArray(ids)) return [];
    const unique = [...new Set(ids.map(String))].slice(0, 10);
    return unique.map((id) => this.items.find((item) => item.id === id)).filter((item): item is StoredAttachment => {
      if (!item) return false;
      // Re-verify containment in case the on-disk index was manually edited.
      return resolve(item.path).startsWith(resolve(DIR) + sep);
    });
  }
  public(item: StoredAttachment): Attachment { const { path: _path, ...safe } = item; return safe; }
}
