import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyMutation, createEmptyState, getBlocks, selectTasks } from "../src/reducer.ts";
import type { TodoParams, TodoState } from "../src/types.ts";

const at = (second = 0) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();

function mutate(state: TodoState, params: TodoParams, timestamp = at()): TodoState {
  return applyMutation(state, params, timestamp).state;
}

describe("reducer lifecycle", () => {
  it("starts and completes by id without status or evidence", () => {
    let state = mutate(createEmptyState(), { action: "create", subject: "Verify behavior" });
    state = mutate(state, { action: "start", id: 1 }, at(1));
    assert.equal(state.tasks[0]?.status, "in_progress");
    assert.equal(state.tasks[0]?.startedAt, at(1));
    state = mutate(state, { action: "complete", id: 1 }, at(2));
    assert.equal(state.tasks[0]?.status, "completed");
    assert.equal(state.tasks[0]?.completedAt, at(2));
    assert.equal(state.tasks[0]?.evidence, undefined);
  });

  it("allows tolerant transitions and idempotent retries", () => {
    let state = mutate(createEmptyState(), { action: "create", subject: "Task" });
    state = mutate(state, { action: "complete", id: 1 }, at(1));
    const repeated = applyMutation(state, { action: "complete", id: 1 }, at(2));
    assert.equal(repeated.changed, false);
    assert.equal(repeated.state, state);
    state = mutate(state, { action: "reopen", id: 1 }, at(3));
    assert.equal(state.tasks[0]?.status, "pending");
    assert.equal(state.tasks[0]?.completedAt, undefined);
    state = mutate(state, { action: "start", id: 1, activeForm: "working" }, at(4));
    const same = applyMutation(state, { action: "start", id: 1, activeForm: "working" }, at(5));
    assert.equal(same.changed, false);
    const relabeled = applyMutation(state, { action: "start", id: 1, activeForm: "testing" }, at(6));
    assert.equal(relabeled.changed, true);
    assert.equal(relabeled.state.tasks[0]?.activeForm, "testing");
  });

  it("keeps an identical start as a no-op even if dependencies changed afterward", () => {
    let state = mutate(createEmptyState(), { action: "create", tasks: [{ subject: "Blocker" }, { subject: "Dependent" }] });
    state = mutate(state, { action: "update", id: 2, addBlockedBy: [1] });
    state = mutate(state, { action: "complete", id: 1 });
    state = mutate(state, { action: "start", id: 2 });
    state = mutate(state, { action: "reopen", id: 1 });
    const repeated = applyMutation(state, { action: "start", id: 2 }, at(10));
    assert.equal(repeated.changed, false);
    assert.equal(repeated.state, state);
  });

  it("stores optional evidence and clears stale evidence on reopen", () => {
    let state = mutate(createEmptyState(), { action: "create", subject: "Task" });
    state = mutate(state, { action: "complete", id: 1, evidence: "38 passed" });
    assert.equal(state.tasks[0]?.evidence, "38 passed");
    state = mutate(state, { action: "reopen", id: 1 });
    assert.equal(state.tasks[0]?.evidence, undefined);
  });
});

describe("create and update validation", () => {
  it("creates an initial batch atomically", () => {
    const state = mutate(createEmptyState(), {
      action: "create",
      tasks: [{ subject: "One" }, { subject: "Two", owner: "worker" }],
    });
    assert.deepEqual(state.tasks.map((task) => task.id), [1, 2]);
    assert.equal(state.nextId, 3);
    assert.equal(state.tasks[1]?.owner, "worker");
  });

  it("rejects sibling dependencies and empty batches without mutation", () => {
    const initial = createEmptyState();
    assert.throws(
      () => applyMutation(initial, { action: "create", tasks: [{ subject: "One" }, { subject: "Two", blockedBy: [1] }] }, at()),
      /another item in this batch/,
    );
    assert.deepEqual(initial, createEmptyState());
    assert.throws(() => applyMutation(initial, { action: "create", tasks: [] }, at()), /subject required/);
  });

  it("rejects action-inapplicable fields and empty updates", () => {
    const state = mutate(createEmptyState(), { action: "create", subject: "Task" });
    assert.throws(() => applyMutation(state, { action: "update", id: 1, tasks: [] }, at()), /tasks is not supported for update/);
    assert.throws(() => applyMutation(state, { action: "update", id: 1 }, at()), /at least one mutable field/);
    assert.throws(() => applyMutation(state, { action: "start", id: 1, status: "in_progress" }, at()), /status is not supported for start/);
  });

  it("updates fields and clears nullable fields", () => {
    let state = mutate(createEmptyState(), { action: "create", subject: "Task", description: "Old", owner: "agent" });
    state = mutate(state, { action: "update", id: 1, description: null, owner: null, activeForm: "working" });
    assert.equal(state.tasks[0]?.description, undefined);
    assert.equal(state.tasks[0]?.owner, undefined);
    assert.equal(state.tasks[0]?.activeForm, "working");
  });
});

describe("dependencies and clearing", () => {
  it("blocks starts until dependencies complete and ignores deleted blockers", () => {
    let state = mutate(createEmptyState(), { action: "create", tasks: [{ subject: "Prerequisite" }, { subject: "Dependent" }] });
    state = mutate(state, { action: "update", id: 2, addBlockedBy: [1] });
    assert.throws(() => applyMutation(state, { action: "start", id: 2 }, at()), /#2 is blocked by #1 \(Prerequisite\)/);
    state = mutate(state, { action: "delete", id: 1 });
    state = mutate(state, { action: "start", id: 2 });
    assert.equal(state.tasks[1]?.status, "in_progress");
  });

  it("rejects self-blocks and cycles", () => {
    let state = mutate(createEmptyState(), { action: "create", tasks: [{ subject: "One" }, { subject: "Two" }] });
    assert.throws(() => applyMutation(state, { action: "update", id: 1, addBlockedBy: [1] }, at()), /itself/);
    state = mutate(state, { action: "update", id: 2, addBlockedBy: [1] });
    assert.throws(() => applyMutation(state, { action: "update", id: 1, addBlockedBy: [2] }, at()), /cycle/);
  });

  it("prunes completed tasks and their dependency edges", () => {
    let state = mutate(createEmptyState(), { action: "create", tasks: [{ subject: "One" }, { subject: "Two" }] });
    state = mutate(state, { action: "update", id: 2, addBlockedBy: [1] });
    state = mutate(state, { action: "complete", id: 1 });
    state = mutate(state, { action: "clear_completed" });
    assert.deepEqual(state.tasks.map((task) => task.id), [2]);
    assert.equal(state.tasks[0]?.blockedBy, undefined);
    assert.equal(state.nextId, 3);
  });

  it("clears everything and resets ids", () => {
    let state = mutate(createEmptyState(), { action: "create", subject: "Task" });
    state = mutate(state, { action: "clear_all" });
    assert.deepEqual(state, createEmptyState());
    state = mutate(state, { action: "create", subject: "New" });
    assert.equal(state.tasks[0]?.id, 1);
  });

  it("rejects multi-node cycles without partially updating dependencies", () => {
    let state = mutate(createEmptyState(), { action: "create", tasks: [{ subject: "One" }, { subject: "Two" }, { subject: "Three" }] });
    state = mutate(state, { action: "update", id: 2, addBlockedBy: [1] });
    state = mutate(state, { action: "update", id: 3, addBlockedBy: [2] });
    assert.throws(() => applyMutation(state, { action: "update", id: 1, addBlockedBy: [3], removeBlockedBy: [2] }, at()), /cycle/);
    assert.equal(state.tasks[0]?.blockedBy, undefined);
    assert.deepEqual(state.tasks[1]?.blockedBy, [1]);
    assert.deepEqual(state.tasks[2]?.blockedBy, [2]);
  });

  it("derives reverse dependency edges", () => {
    let state = mutate(createEmptyState(), { action: "create", tasks: [{ subject: "One" }, { subject: "Two" }] });
    state = mutate(state, { action: "update", id: 2, addBlockedBy: [1] });
    assert.deepEqual(getBlocks(state, 1), [2]);
  });
});

describe("list selection", () => {
  it("does not expose mutable completed tasks from internal state", () => {
    let state = mutate(createEmptyState(), { action: "create", tasks: [{ subject: "One" }, { subject: "Two" }] });
    state = mutate(state, { action: "update", id: 1, addBlockedBy: [2] });
    state = mutate(state, { action: "complete", id: 1 });
    const completed = selectTasks(state, "completed");
    completed[0]!.subject = "Changed outside reducer";
    completed[0]!.blockedBy!.push(99);
    assert.equal(state.tasks[0]?.subject, "One");
    assert.deepEqual(state.tasks[0]?.blockedBy, [2]);
    const defaults = selectTasks(state);
    defaults.find((task) => task.status === "completed")!.subject = "Another mutation";
    assert.equal(state.tasks[0]?.subject, "One");
  });

  it("returns open tasks and only the latest three completed by default", () => {
    let state = createEmptyState();
    for (let id = 1; id <= 50; id += 1) {
      state = mutate(state, { action: "create", subject: `Task ${id}` }, at(id));
      state = mutate(state, { action: "complete", id }, at(id + 100));
    }
    state = mutate(state, { action: "create", subject: "Open" }, at(200));
    const selected = selectTasks(state);
    assert.equal(selected.filter((task) => task.status === "completed").length, 3);
    assert.deepEqual(selected.filter((task) => task.status === "completed").map((task) => task.id), [50, 49, 48]);
    assert.equal(selected[0]?.subject, "Open");
    assert.equal(selectTasks(state, "all").length, 51);
    assert.equal(selectTasks(state, "completed", 0).length, 0);
  });
});
