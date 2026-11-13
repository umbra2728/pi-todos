import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { applyMutation, createEmptyState } from "../src/reducer.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TodoState } from "../src/types.ts";
import { formatCommandTasks, formatRecovery, renderOverlay, renderPlainOverlay, SETTLE_REMINDER, settleReminderText } from "../src/view.ts";

const theme = {
  fg: (_color: string, value: string) => value,
  bold: (value: string) => value,
  strikethrough: (value: string) => value,
} as Theme;

const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();

function longState(): TodoState {
  let state = createEmptyState();
  for (let id = 1; id <= 6; id += 1) {
    state = applyMutation(state, { action: "create", subject: `Task ${id}` }, at(id)).state;
    if (id <= 4) state = applyMutation(state, { action: "complete", id }, at(id + 10)).state;
  }
  return state;
}

describe("overlay and recovery view", () => {
  it("shows open tasks and three recent completed tasks", () => {
    const lines = renderOverlay(longState(), DEFAULT_CONFIG, theme, 200);
    assert.match(lines[0]!, /Todos 4\/6/);
    assert.ok(lines.some((line) => line.includes("#4 Task 4")));
    assert.ok(lines.some((line) => line.includes("#2 Task 2")));
    assert.ok(!lines.some((line) => line.includes("#1 Task 1")));
    assert.ok(lines.some((line) => line.includes("#5 Task 5")));
    assert.ok(lines.some((line) => line.includes("#6 Task 6")));
  });

  it("bounds the overlay and hides older rows with an exact summary", () => {
    const lines = renderOverlay(longState(), { ...DEFAULT_CONFIG, maxOverlayLines: 5 }, theme, 200);
    assert.equal(lines.length, 5);
    assert.match(lines.at(-1)!, /^\+2 more$/);
  });

  it("counts only hidden open tasks after completed rows are dropped", () => {
    let state = longState();
    for (let id = 7; id <= 24; id += 1) {
      state = applyMutation(state, { action: "create", subject: `Task ${id}` }, at(id)).state;
    }
    const themed = renderOverlay(state, DEFAULT_CONFIG, theme, 200);
    const plain = renderPlainOverlay(state, DEFAULT_CONFIG);
    assert.equal(themed.at(-1), "+10 more");
    assert.equal(plain.at(-1), "+10 more");
  });

  it("uses the same bounded task selection for plain RPC overlays", () => {
    const lines = renderPlainOverlay(longState(), { ...DEFAULT_CONFIG, maxOverlayLines: 5 });
    assert.equal(lines.length, 5);
    assert.match(lines[0]!, /Todos 4\/6/);
    assert.equal(lines.at(-1), "+2 more");
    assert.ok(!lines.some((line) => line.includes("#1 Task 1")));
  });

  it("returns no overlay for an empty or deleted-only list", () => {
    assert.deepEqual(renderOverlay(createEmptyState(), DEFAULT_CONFIG, theme, 80), []);
    const deleted = applyMutation(createEmptyState(), { action: "create", subject: "Deleted" }, at(1)).state;
    const state = applyMutation(deleted, { action: "delete", id: 1 }, at(2)).state;
    assert.deepEqual(renderOverlay(state, DEFAULT_CONFIG, theme, 80), []);
  });

  it("includes only open tasks in compaction recovery", () => {
    const recovery = formatRecovery(longState());
    assert.ok(recovery.includes("#5 [pending] Task 5"));
    assert.ok(recovery.includes("#6 [pending] Task 6"));
    assert.ok(!recovery.includes("#4 Task 4"));
  });

  it("uses the approved balanced settle reminder", () => {
    const text = settleReminderText(longState());
    assert.ok(SETTLE_REMINDER.includes("intentionally pausing to ask the user a question"));
    assert.ok(SETTLE_REMINDER.includes("Otherwise, continue working and complete the remaining tasks"));
    assert.ok(text.includes("#5 [pending] Task 5"));
  });

  it("formats full and filtered command views", () => {
    assert.match(formatCommandTasks(longState()), /── completed ──/);
    assert.doesNotMatch(formatCommandTasks(longState(), "pending"), /── completed ──/);
    assert.match(formatCommandTasks(longState(), "all"), /Task 1/);
  });
});
