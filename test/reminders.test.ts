import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import piTodos from "../src/index.ts";
import { createHost } from "./host.ts";
import type { TestHost } from "./host.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "pi-todos-reminders-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

afterEach(() => {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  rmSync(join(agentDir, "pi-todos.json"), { force: true });
});

after(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

async function execute(host: TestHost, params: Record<string, unknown>) {
  const tool = host.tools.get("todo") as unknown as {
    execute: (id: string, params: never, signal: undefined, update: undefined, ctx: never) => Promise<never>;
  };
  return tool.execute("call-1", params as never, undefined, undefined, host.ctx as never);
}

function settleEvent() {
  return { outcome: "completed", entries: [], continue: false };
}

interface SettleResult {
  continue?: boolean;
  entries: Array<{ content: string }>;
}

interface ContextResult {
  messages: Array<{ content: string }>;
}

describe("settle reminder", () => {
  it("runs once per genuine user prompt and not for its own continuation", async () => {
    const host = createHost();
    piTodos(host.pi as never);
    await execute(host, { action: "create", subject: "Open task" });
    const first = (await host.emit("agent_before_settle", settleEvent())) as SettleResult[];
    assert.equal(first[0]?.continue, true);
    assert.equal(first[0]?.entries.length, 1);
    assert.match(first[0]?.entries[0].content, /Otherwise, continue working/);
    const second = await host.emit("agent_before_settle", settleEvent());
    assert.equal(second[0], undefined);
    await host.emit("message_start", { message: { role: "custom", customType: "pi-todos-settle-reminder" } });
    const third = await host.emit("agent_before_settle", settleEvent());
    assert.equal(third[0], undefined);
    await host.emit("message_start", { message: { role: "user" } });
    const fourth = (await host.emit("agent_before_settle", settleEvent())) as SettleResult[];
    assert.equal(fourth[0]?.continue, true);
  });

  it("does not request continuation after an aborted run", async () => {
    const host = createHost();
    piTodos(host.pi as never);
    await execute(host, { action: "create", subject: "Open task" });
    const result = await host.emit("agent_before_settle", { ...settleEvent(), outcome: "aborted" });
    assert.equal(result[0], undefined);
  });

  it("can be disabled through config", async () => {
    writeFileSync(join(agentDir, "pi-todos.json"), JSON.stringify({ settleReminder: false }));
    const host = createHost();
    piTodos(host.pi as never);
    await execute(host, { action: "create", subject: "Open task" });
    const result = await host.emit("agent_before_settle", settleEvent());
    assert.equal(result[0], undefined);
  });
});

describe("recovery reminder", () => {
  it("injects open tasks once after session restoration", async () => {
    const host = createHost();
    piTodos(host.pi as never);
    await execute(host, { action: "create", subject: "Open task" });
    await host.emit("session_start", {});
    const first = (await host.emit("context", { messages: [] })) as ContextResult[];
    assert.equal(first[0].messages.length, 1);
    assert.match(first[0].messages[0].content, /Open task/);
    const second = await host.emit("context", { messages: [] });
    assert.equal(second[0], undefined);
  });
});
