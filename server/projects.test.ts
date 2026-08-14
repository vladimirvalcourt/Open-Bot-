import { beforeEach, describe, expect, it, vi } from "vitest";
const memory = new Map<string, string>();
vi.mock("node:fs", async () => ({
  chmodSync: vi.fn(), mkdirSync: vi.fn(), renameSync: (from: string, to: string) => { memory.set(to, memory.get(from) ?? ""); memory.delete(from); },
  writeFileSync: (file: string, data: string) => memory.set(file, data),
  readFileSync: (file: string) => { if (!memory.has(file)) throw new Error("missing"); return memory.get(file); },
}));
describe("ProjectStore", () => {
  beforeEach(() => memory.clear());
  it("creates a default scope and durable named projects", async () => {
    const { ProjectStore } = await import("./projects.ts");
    const store = new ProjectStore();
    expect(store.get("default")?.name).toBe("General");
    const created = store.create("Meezic", "Music product");
    expect(store.get(created.id)).toMatchObject({ name: "Meezic", description: "Music product" });
  });
  it("records knowledge provenance and freshness", async () => {
    const { ProjectStore } = await import("./projects.ts");
    const store = new ProjectStore();
    const project = store.create("Research");
    const source = store.addKnowledge(project.id, { title: "Primary source", kind: "url", location: "https://example.com" });
    expect(source?.lastVerifiedAt).toBeUndefined();
    expect(store.verifyKnowledge(project.id, source!.id)?.lastVerifiedAt).toBeTypeOf("number");
  });
});
