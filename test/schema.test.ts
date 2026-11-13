import assert from "node:assert/strict";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { describe, it } from "node:test";
import { prepareTodoArguments } from "../src/normalize.ts";
import { TodoParamsSchema } from "../src/schema.ts";

const tool = { name: "todo", description: "Test todo tool", parameters: TodoParamsSchema };

function validate(args: unknown) {
  return validateToolArguments(tool, { type: "toolCall", id: "call-1", name: "todo", arguments: prepareTodoArguments(args) as never });
}

describe("Pi schema validation", () => {
  it("accepts minimal lifecycle calls", () => {
    assert.deepEqual(validate({ action: "start", id: 1 }), { action: "start", id: 1 });
    assert.deepEqual(validate({ action: "complete", id: 1 }), { action: "complete", id: 1 });
  });

  it("accepts legacy status updates after normalization", () => {
    assert.deepEqual(validate({ action: "update", id: 1, status: "completed" }), { action: "complete", id: 1 });
  });

  it("rejects unknown and malformed properties before execution", () => {
    assert.throws(() => validate({ action: "update", id: 1, includeDeleted: false }), /includeDeleted/);
    assert.throws(() => validate({ action: "update", id: 1, "status”": null }), /status/);
  });

  it("rejects conflicting canonical and alias IDs", () => {
    assert.throws(() => validate({ action: "delete", id: 1, taskId: 2 }), /taskId/);
  });

  it("validates strict batch item properties", () => {
    assert.deepEqual(
      validate({ action: "create", tasks: [{ subject: "Task", activeForm: "working" }] }),
      { action: "create", tasks: [{ subject: "Task", activeForm: "working" }] },
    );
    assert.throws(() => validate({ action: "create", tasks: [{ subject: "Task", priority: "high" }] }), /priority/);
  });
});
