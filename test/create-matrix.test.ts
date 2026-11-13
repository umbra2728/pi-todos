import assert from "node:assert/strict";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { describe, it } from "node:test";
import { prepareTodoArguments } from "../src/normalize.ts";
import { applyMutation } from "../src/reducer.ts";
import { TodoParamsSchema } from "../src/schema.ts";
import type { TodoParams, TodoState } from "../src/types.ts";

const tool = { name: "todo", description: "Test todo tool", parameters: TodoParamsSchema };

function create(raw: unknown, initial: TodoState = { tasks: [], nextId: 16 }) {
  const args = validateToolArguments(tool, {
    type: "toolCall",
    id: "call-1",
    name: "todo",
    arguments: prepareTodoArguments(raw) as never,
  });
  return applyMutation(initial, args as TodoParams, "2026-01-01T00:00:00.000Z").state;
}

describe("create payload matrix", () => {
  it("supports full single-create fields without model-owned lifecycle state", () => {
    const state = create({
      action: "create",
      id: 16,
      subject: "Task",
      description: "Details",
      activeForm: "working",
      owner: "agent",
      status: "in_progress",
      evidence: null,
      addBlockedBy: null,
      removeBlockedBy: null,
      tasks: null,
      completedLimit: null,
    });
    assert.equal(state.tasks[0]?.activeForm, "working");
    assert.equal(state.tasks[0]?.owner, "agent");
    assert.equal(state.tasks[0]?.status, "pending");
  });

  it("supports activeForm in every batch item", () => {
    const state = create({
      action: "create",
      tasks: [
        { subject: "Find an exploitable primitive", description: "Review the source", activeForm: "finding an exploitable primitive" },
        { subject: "Build and validate the exploit chain", description: "Validate locally", activeForm: "building and validating the exploit chain" },
      ],
    });
    assert.deepEqual(state.tasks.map((task) => task.activeForm), ["finding an exploitable primitive", "building and validating the exploit chain"]);
  });

  it("supports common title, content, active_form, and dependsOn aliases", () => {
    const state = create({
      action: "create",
      tasks: [
        { id: "custom", title: "Research", active_form: "researching", status: "pending" },
        { content: "Implement", activeForm: "implementing", dependsOn: [16] },
      ],
    });
    assert.deepEqual(state.tasks.map((task) => task.subject), ["Research", "Implement"]);
    assert.deepEqual(state.tasks[1]?.blockedBy, [16]);
    assert.deepEqual(state.tasks.map((task) => task.activeForm), ["researching", "implementing"]);
  });

  it("normalizes dependsOn for single create", () => {
    const existing = create({ action: "create", subject: "Existing" });
    const state = create({ action: "create", subject: "Task", dependsOn: [16] }, existing);
    assert.deepEqual(state.tasks[1]?.blockedBy, [16]);
  });

  it("treats canonical null as absent during alias normalization", () => {
    const state = create({
      action: "create",
      subject: null,
      title: "Task",
      activeForm: null,
      active_form: "working",
      tasks: null,
      dependsOn: null,
    });
    assert.equal(state.tasks[0]?.subject, "Task");
    assert.equal(state.tasks[0]?.activeForm, "working");
    const batch = create({
      action: "create",
      tasks: [{ subject: "One" }, { subject: "Two", blockedBy: null, dependsOn: [16] }],
    });
    assert.deepEqual(batch.tasks[1]?.blockedBy, [16]);
  });

  it("rejects direct reducer calls with activeForm beside a batch", () => {
    assert.throws(
      () => applyMutation({ tasks: [], nextId: 1 }, { action: "create", activeForm: "working", tasks: [{ subject: "Task" }] }, "2026-01-01T00:00:00.000Z"),
      /activeForm on each item/,
    );
  });

  it("accepts earlier batch dependencies and rejects forward references", () => {
    const state = create({
      action: "create",
      tasks: [{ subject: "One" }, { subject: "Two" }, { subject: "Three", blockedBy: [16, 17] }],
    });
    assert.deepEqual(state.tasks[2]?.blockedBy, [16, 17]);
    assert.throws(() => create({ action: "create", tasks: [{ subject: "One", blockedBy: [17] }, { subject: "Two" }] }), /earlier batch item/);
  });

  it("does not silently discard conflicting subject aliases", () => {
    assert.throws(() => create({ action: "create", tasks: [{ subject: "Canonical", title: "Conflicting" }] }), /title/);
  });

  it("rejects unsupported fields instead of looping through execution", () => {
    assert.throws(() => create({ action: "create", tasks: [{ subject: "Task", priority: "high" }] }), /priority/);
  });
});
