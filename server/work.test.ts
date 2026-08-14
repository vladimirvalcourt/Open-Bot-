import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, string>();
vi.mock("node:fs", async () => ({
  chmodSync: vi.fn(), mkdirSync: vi.fn(), renameSync: (from: string, to: string) => { memory.set(to, memory.get(from) ?? ""); memory.delete(from); },
  writeFileSync: (file: string, data: string) => memory.set(file, data),
  readFileSync: (file: string) => { if (!memory.has(file)) throw new Error("missing"); return memory.get(file); },
}));

describe("WorkStore", () => {
  beforeEach(() => memory.clear());
  it("tracks a run through real completion", async () => {
    const { WorkStore } = await import("./work.ts");
    const store = new WorkStore();
    const task = store.createTask({ botId: "b1", title: "Report", prompt: "Do it", source: "manual" });
    const run = store.startRun(task.id, "thread-1");
    const checkpoint = store.checkpoint(run.id, { kind: "files", label: "Before edit", reversible: true, stateBefore: { hash: "abc" } });
    store.appendOutput(run.id, "done");
    store.usage(run.id, 10, 5);
    store.finish(run.id, true);
    expect(store.task(task.id)?.status).toBe("succeeded");
    expect(store.run(run.id)).toMatchObject({ status: "succeeded", output: "done", inputTokens: 10, outputTokens: 5, checkpointIds: [checkpoint?.id] });
  });

  it("persists a central approval record", async () => {
    const { WorkStore } = await import("./work.ts");
    const store = new WorkStore();
    store.openApproval({ requestId: "r1", botId: "b", threadId: "t", type: "permission", tool: "shell", summary: "run command" });
    store.resolveApproval("r1", "allow");
    expect(store.data.approvals[0]).toMatchObject({ status: "resolved", resolution: "allow" });
  });

  it("indexes tasks by idempotency key", async () => {
    const { WorkStore } = await import("./work.ts");
    const store = new WorkStore();
    const task = store.createTask({ botId: "b1", title: "Send once", prompt: "Do it", source: "manual", idempotencyKey: "request-1" });
    expect(store.taskByIdempotency("b1", "request-1")?.id).toBe(task.id);
    expect(store.taskByIdempotency("b2", "request-1")).toBeNull();
  });
});
