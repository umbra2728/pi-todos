import assert from "node:assert/strict";
import { describe, it } from "node:test";
import piTodos from "../src/index.ts";
import { prepareTodoArguments } from "../src/normalize.ts";
import { replayOperations, TODO_OPERATION_TYPE } from "../src/replay.ts";
import { getSessionState } from "../src/store.ts";
import type { TodoToolOutput } from "../src/types.ts";
import { createHost } from "./host.ts";
import type { TestHost } from "./host.ts";

async function execute(host: TestHost, params: Record<string, unknown>): Promise<{ details: TodoToolOutput }> {
  const tool = host.tools.get("todo") as unknown as {
    execute: (id: string, params: never, signal: undefined, update: undefined, ctx: never) => Promise<{ details: TodoToolOutput }>;
  };
  return tool.execute("call-1", params as never, undefined, undefined, host.ctx as never);
}

describe("tool and journal integration", () => {
  it("journals only real mutations and replays the exact live state", async () => {
    const host = createHost();
    piTodos(host.pi as never);
    await execute(host, { action: "create", subject: "Task" });
    assert.equal(host.entries.length, 1);
    await execute(host, { action: "start", id: 1, activeForm: "working" });
    assert.equal(host.entries.length, 2);
    const repeated = await execute(host, { action: "start", id: 1, activeForm: "working" });
    assert.equal(repeated.details.changed, false);
    assert.equal(host.entries.length, 2);
    await execute(host, { action: "list" });
    await execute(host, { action: "get", id: 1 });
    assert.equal(host.entries.length, 2);
    await assert.rejects(execute(host, { action: "update", id: 1 }), /at least one mutable field/);
    assert.equal(host.entries.length, 2);
    await execute(host, { action: "complete", id: 1, evidence: "verified" });
    assert.equal(host.entries.length, 3);
    const live = getSessionState(host.ctx as never);
    const restored = replayOperations(host.entries).state;
    assert.deepEqual(restored, live);
    assert.ok(host.entries.every((entry) => {
      const data = (entry as { data: Record<string, unknown> }).data;
      return !("tasks" in data);
    }));
  });

  it("accepts the exact repeated batch shape emitted by Kimi", async () => {
    const host = createHost();
    piTodos(host.pi as never);
    await execute(host, {
      action: "create",
      tasks: Array.from({ length: 15 }, (_, index) => ({ subject: `Existing ${index + 1}` })),
    });
    const raw = {
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
    };
    const result = await execute(host, prepareTodoArguments(raw) as unknown as Record<string, unknown>);
    assert.deepEqual(result.details.ids, [16, 17, 18]);
    const state = getSessionState(host.ctx as never);
    assert.deepEqual(state.tasks.slice(15).map((task) => task.subject), ["Audit engine", "Audit host", "Develop proof"]);
    assert.deepEqual(state.tasks[17]?.blockedBy, [16, 17]);
    assert.ok(state.tasks.slice(15).every((task) => task.status === "pending"));
  });

  it("accepts and preserves activeForm inside batch items", async () => {
    const host = createHost();
    piTodos(host.pi as never);
    const result = await execute(host, {
      action: "create",
      tasks: [
        {
          subject: "Find an exploitable primitive",
          description: "Perform a full-scope source review",
          activeForm: "finding an exploitable primitive",
        },
        {
          subject: "Build and validate the exploit chain",
          description: "Turn a validated primitive into a controlled local exploit",
          activeForm: "building and validating the exploit chain",
        },
      ],
    });
    assert.deepEqual(result.details.ids, [1, 2]);
    const state = getSessionState(host.ctx as never);
    assert.deepEqual(state.tasks.map((task) => task.activeForm), [
      "finding an exploitable primitive",
      "building and validating the exploit chain",
    ]);
    await execute(host, { action: "start", id: 1 });
    assert.equal(getSessionState(host.ctx as never).tasks[0]?.activeForm, "finding an exploitable primitive");
  });

  it("rejects inapplicable fields on query actions", async () => {
    const host = createHost();
    piTodos(host.pi as never);
    await execute(host, { action: "create", subject: "Task" });
    await assert.rejects(execute(host, { action: "list", id: 1 }), /id is not supported for list/);
    await assert.rejects(execute(host, { action: "get", id: 1, subject: "ignored" }), /subject is not supported for get/);
    assert.equal(host.entries.length, 1);
  });

  it("rejects a limit for the open command filter", async () => {
    const host = createHost();
    host.ctx.hasUI = true;
    piTodos(host.pi as never);
    const command = host.commands.get("todos") as unknown as {
      handler: (args: string, ctx: never) => Promise<void>;
    };
    await command.handler("open 5", host.ctx as never);
    assert.deepEqual(host.notifications, ["A limit is accepted only after completed"]);
  });

  it("reports replay warnings without a UI", async () => {
    const host = createHost();
    piTodos(host.pi as never);
    host.entries.push({ type: "custom", customType: TODO_OPERATION_TYPE, id: "broken", data: { version: 1 } });
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: unknown) => {
      warnings.push(String(message));
    };
    try {
      await host.emit("session_start", {});
    } finally {
      console.warn = original;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /Skipped invalid todo operation broken/);
  });
});
