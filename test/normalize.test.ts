import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareTodoArguments } from "../src/normalize.ts";

describe("argument normalization", () => {
  it("keeps lifecycle calls free of status", () => {
    assert.deepEqual(prepareTodoArguments({ action: "start", id: 1 }), { action: "start", id: 1 });
    assert.deepEqual(prepareTodoArguments({ action: "complete", id: 1 }), { action: "complete", id: 1 });
  });

  it("normalizes field and action aliases", () => {
    assert.deepEqual(
      prepareTodoArguments({ action: "start", taskId: 2, active_form: "writing tests" }),
      { action: "start", id: 2, activeForm: "writing tests" },
    );
    assert.deepEqual(prepareTodoArguments({ action: "add", subject: "Task" }), { action: "create", subject: "Task" });
    assert.deepEqual(prepareTodoArguments({ action: "done", task_id: 3 }), { action: "complete", id: 3 });
  });

  it("preserves conflicting aliases for strict rejection", () => {
    assert.deepEqual(prepareTodoArguments({ action: "delete", id: 1, taskId: 2 }), {
      action: "delete",
      id: 1,
      taskId: 2,
    });
    assert.deepEqual(prepareTodoArguments({ action: "start", id: 1, activeForm: "one", active_form: "two" }), {
      action: "start",
      id: 1,
      activeForm: "one",
      active_form: "two",
    });
  });

  it("drops redundant statuses from explicit lifecycle actions", () => {
    assert.deepEqual(prepareTodoArguments({ action: "start", id: 1, status: "in_progress" }), { action: "start", id: 1 });
    assert.deepEqual(prepareTodoArguments({ action: "complete", id: 1, status: "completed" }), { action: "complete", id: 1 });
    assert.deepEqual(prepareTodoArguments({ action: "complete", id: 1, status: "done" }), { action: "complete", id: 1 });
    assert.deepEqual(prepareTodoArguments({ action: "reopen", id: 1, status: "pending" }), { action: "reopen", id: 1 });
    assert.deepEqual(prepareTodoArguments({ action: "delete", id: 1, status: "deleted" }), { action: "delete", id: 1 });
  });

  it("maps legacy status updates to lifecycle actions", () => {
    assert.deepEqual(prepareTodoArguments({ action: "update", id: 1, status: "in_progress" }), { action: "start", id: 1 });
    assert.deepEqual(prepareTodoArguments({ action: "update", id: 1, status: "completed" }), { action: "complete", id: 1 });
    assert.deepEqual(prepareTodoArguments({ action: "update", id: 1, status: "pending" }), { action: "reopen", id: 1 });
    assert.deepEqual(prepareTodoArguments({ action: "update", id: 1, status: "deleted" }), { action: "delete", id: 1 });
  });

  it("does not invent a status for historically malformed updates", () => {
    assert.deepEqual(prepareTodoArguments({ action: "update", id: 1, includeDeleted: false, tasks: [] }), {
      action: "update",
      id: 1,
      includeDeleted: false,
      tasks: [],
    });
  });

  it("decodes double-encoded batches and strips optional nulls", () => {
    assert.deepEqual(
      prepareTodoArguments({ action: "create", tasks: "[{\"subject\":\"One\"},{\"subject\":\"Two\",\"owner\":null}]" }),
      { action: "create", tasks: [{ subject: "One" }, { subject: "Two" }] },
    );
    assert.deepEqual(prepareTodoArguments({ action: "start", id: 1, activeForm: null }), { action: "start", id: 1 });
    assert.deepEqual(prepareTodoArguments({ action: "update", id: 1, description: null }), {
      action: "update",
      id: 1,
      description: null,
    });
  });

  it("sanitizes lifecycle fields from a model-generated single create", () => {
    assert.deepEqual(
      prepareTodoArguments({
        action: "create",
        id: 16,
        subject: "Find and validate a working RCE",
        description: "Continue review",
        activeForm: "hunting and validating an RCE",
        owner: null,
        evidence: null,
        blockedBy: null,
        addBlockedBy: null,
        removeBlockedBy: null,
        tasks: null,
        status: "in_progress",
        completedLimit: null,
      }),
      { action: "create", subject: "Find and validate a working RCE", description: "Continue review" },
    );
  });

  it("prefers a batch over conflicting top-level single-create fields", () => {
    assert.deepEqual(
      prepareTodoArguments({
        action: "create",
        id: 16,
        subject: "Parent title supplied by the model",
        description: "Top-level description",
        activeForm: "working",
        owner: null,
        evidence: null,
        blockedBy: null,
        addBlockedBy: null,
        removeBlockedBy: null,
        tasks: [
          { subject: "Audit engine", description: "Review memory code", blockedBy: [], owner: null },
          { subject: "Audit host", description: "Review renderer", blockedBy: [], owner: null },
          { subject: "Develop proof", description: "Validate locally", blockedBy: [16, 17], owner: null },
        ],
        status: "in_progress",
        completedLimit: null,
      }),
      {
        action: "create",
        tasks: [
          { subject: "Audit engine", description: "Review memory code", blockedBy: [] },
          { subject: "Audit host", description: "Review renderer", blockedBy: [] },
          { subject: "Develop proof", description: "Validate locally", blockedBy: [16, 17] },
        ],
      },
    );
  });

  it("preserves malformed keys for strict rejection", () => {
    assert.deepEqual(prepareTodoArguments({ action: "update", id: 1, "status”": null }), {
      action: "update",
      id: 1,
      "status”": null,
    });
  });
});
