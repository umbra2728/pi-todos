import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replayOperations, TODO_OPERATION_TYPE } from "../src/replay.ts";

const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();

function operation(action: string, params: Record<string, unknown>, second = 0, id?: string) {
  return {
    type: "custom",
    customType: TODO_OPERATION_TYPE,
    ...(id ? { id } : {}),
    data: { version: 1, at: at(second), action, params: { action, ...params } },
  };
}

describe("operation replay", () => {
  it("restores tasks, ids, timestamps, dependencies, and status", () => {
    const restored = replayOperations([
      operation("create", { subject: "Research" }, 1),
      operation("create", { subject: "Implement" }, 2),
      operation("update", { id: 2, addBlockedBy: [1] }, 3),
      operation("start", { id: 1, activeForm: "researching" }, 4),
      operation("complete", { id: 1, evidence: "done" }, 5),
      operation("start", { id: 2 }, 6),
    ]);
    assert.equal(restored.warnings.length, 0);
    assert.equal(restored.state.tasks[0]?.status, "completed");
    assert.equal(restored.state.tasks[0]?.completedAt, at(5));
    assert.equal(restored.state.tasks[1]?.status, "in_progress");
    assert.deepEqual(restored.state.tasks[1]?.blockedBy, [1]);
    assert.equal(restored.state.nextId, 3);
  });

  it("keeps independent branches isolated", () => {
    const first = replayOperations([operation("create", { subject: "First" })]).state;
    const second = replayOperations([operation("create", { subject: "Second" })]).state;
    assert.equal(first.tasks[0]?.subject, "First");
    assert.equal(second.tasks[0]?.subject, "Second");
  });

  it("warns about malformed entries without erasing recoverable state", () => {
    const restored = replayOperations([
      operation("create", { subject: "Valid" }),
      { type: "custom", customType: TODO_OPERATION_TYPE, id: "bad", data: { version: 1 } },
      operation("create", { subject: "Still valid" }),
    ]);
    assert.equal(restored.state.tasks.length, 2);
    assert.equal(restored.warnings.length, 1);
    assert.match(restored.warnings[0]!, /Skipped invalid todo operation bad/);
  });

  it("replays clear_completed and clear_all", () => {
    const entries = [
      operation("create", { subject: "One" }),
      operation("create", { subject: "Two" }),
      operation("update", { id: 2, addBlockedBy: [1] }),
      operation("complete", { id: 1 }),
      operation("clear_completed", {}),
    ];
    const pruned = replayOperations(entries).state;
    assert.deepEqual(pruned.tasks.map((task) => task.id), [2]);
    assert.equal(pruned.tasks[0]?.blockedBy, undefined);
    const cleared = replayOperations([...entries, operation("clear_all", {}), operation("create", { subject: "New" })]).state;
    assert.deepEqual(cleared.tasks.map((task) => [task.id, task.subject]), [[1, "New"]]);
  });

  it("stores bounded operations instead of repeated snapshots for long histories", () => {
    const entries = [operation("create", { tasks: Array.from({ length: 50 }, (_, index) => ({ subject: `Task ${index + 1}` })) })];
    for (let id = 1; id <= 50; id += 1) entries.push(operation("complete", { id }, id));
    entries.push(operation("create", { subject: "Open" }, 100));
    const restored = replayOperations(entries);
    assert.equal(restored.state.tasks.length, 51);
    assert.equal(entries.length, 52);
    assert.ok(JSON.stringify(entries.at(-1)).length < 300);
    assert.ok(entries.every((entry) => !("tasks" in entry.data)));
  });

  it("ignores legacy plugin snapshots", () => {
    const restored = replayOperations([
      { type: "custom", customType: "rpiv-todo-state", data: { tasks: [{ id: 1, subject: "Legacy", status: "pending" }] } },
    ]);
    assert.deepEqual(restored.state, { tasks: [], nextId: 1 });
  });
});
