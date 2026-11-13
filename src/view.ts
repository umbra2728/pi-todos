import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { getBlocks, openTasks, selectTasks } from "./reducer.ts";
import type { ListStatus, Task, TodoConfig, TodoState } from "./types.ts";

export const SETTLE_REMINDER =
  "Review the open tasks before finishing. If you are intentionally pausing to ask the user a question, waiting for input, or leaving background work running, keep their statuses unchanged and finish normally. Otherwise, continue working and complete the remaining tasks. Reconcile any completed work with the todo list before finishing.";

function plain(value: string): string {
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}\p{Cf}]+/gu, " ").trim();
}

function unresolved(state: TodoState, task: Task): number[] {
  return (task.blockedBy ?? []).filter((id) => {
    const dependency = state.tasks.find((candidate) => candidate.id === id);
    return dependency && dependency.status !== "completed" && dependency.status !== "deleted";
  });
}

function glyph(task: Task, theme?: Theme): string {
  const value = task.status === "completed" ? "✓" : task.status === "in_progress" ? "◐" : task.status === "deleted" ? "⊘" : "○";
  if (!theme) return value;
  const color = task.status === "completed" ? "success" : task.status === "in_progress" ? "warning" : "dim";
  return theme.fg(color, value);
}

export function formatTaskLine(state: TodoState, task: Task, theme?: Theme): string {
  const blockers = unresolved(state, task);
  const activity = task.status === "in_progress" && task.activeForm ? ` (${plain(task.activeForm)})` : "";
  const owner = task.owner ? ` @${plain(task.owner)}` : "";
  const dependencies = blockers.length ? ` ⛓ ${blockers.map((id) => `#${id}`).join(",")}` : "";
  const subject = plain(task.subject);
  const styledSubject = theme && task.status === "completed" ? theme.strikethrough(theme.fg("dim", subject)) : subject;
  return `${glyph(task, theme)} #${task.id} ${styledSubject}${activity}${owner}${dependencies}`;
}

export function formatTaskList(state: TodoState, tasks: Task[]): string {
  return tasks.length ? tasks.map((task) => `[${task.status}] #${task.id} ${plain(task.subject)}${task.activeForm && task.status === "in_progress" ? ` (${plain(task.activeForm)})` : ""}${task.owner ? ` @${plain(task.owner)}` : ""}`).join("\n") : "No tasks";
}

export function formatTaskDetails(state: TodoState, task: Task): string {
  const lines = [`#${task.id} [${task.status}] ${plain(task.subject)}`];
  if (task.description) lines.push(`  description: ${plain(task.description)}`);
  if (task.activeForm) lines.push(`  activeForm: ${plain(task.activeForm)}`);
  if (task.owner) lines.push(`  owner: ${plain(task.owner)}`);
  if (task.evidence) lines.push(`  evidence: ${plain(task.evidence)}`);
  if (task.blockedBy?.length) lines.push(`  blockedBy: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`);
  const blocks = getBlocks(state, task.id);
  if (blocks.length) lines.push(`  blocks: ${blocks.map((id) => `#${id}`).join(", ")}`);
  lines.push(`  createdAt: ${task.createdAt}`);
  if (task.startedAt) lines.push(`  startedAt: ${task.startedAt}`);
  if (task.completedAt) lines.push(`  completedAt: ${task.completedAt}`);
  return lines.join("\n");
}

export function formatRecovery(state: TodoState): string {
  const tasks = openTasks(state);
  if (!tasks.length) return "";
  return [
    "Current open tasks from the todo list:",
    ...tasks.map((task) => `#${task.id} [${task.status}] ${plain(task.subject)}`),
    "Reconcile these statuses with actual progress before changing them.",
  ].join("\n");
}

function overlayWindow(state: TodoState, config: TodoConfig): { tasks: Task[]; visible: Task[]; hidden: number } {
  const tasks = selectTasks(state, undefined, config.completedInOverlay);
  const budget = Math.max(0, config.maxOverlayLines - 1);
  if (tasks.length <= budget) return { tasks, visible: tasks, hidden: 0 };
  const rowBudget = Math.max(0, budget - 1);
  const openCount = tasks.filter((task) => task.status === "pending" || task.status === "in_progress").length;
  return {
    tasks,
    visible: tasks.slice(0, rowBudget),
    hidden: openCount > rowBudget ? openCount - rowBudget : tasks.length - rowBudget,
  };
}

export function renderOverlay(state: TodoState, config: TodoConfig, theme: Theme, width: number): string[] {
  const { tasks, visible, hidden } = overlayWindow(state, config);
  if (!tasks.length) return [];
  const completed = state.tasks.filter((task) => task.status === "completed").length;
  const total = state.tasks.filter((task) => task.status !== "deleted").length;
  const header = theme.fg("accent", theme.bold(`Todos ${completed}/${total}`));
  const lines = [header, ...visible.map((task) => formatTaskLine(state, task, theme))];
  if (hidden) lines.push(theme.fg("dim", `+${hidden} more`));
  return lines.map((line) => truncateToWidth(line, width, "…"));
}

export function renderPlainOverlay(state: TodoState, config: TodoConfig): string[] {
  const { tasks, visible, hidden } = overlayWindow(state, config);
  if (!tasks.length) return [];
  const completed = state.tasks.filter((task) => task.status === "completed").length;
  const total = state.tasks.filter((task) => task.status !== "deleted").length;
  const lines = [`Todos ${completed}/${total}`, ...visible.map((task) => formatTaskLine(state, task))];
  if (hidden) lines.push(`+${hidden} more`);
  return lines;
}

export function formatCommandTasks(state: TodoState, status?: ListStatus, completedLimit = 3): string {
  const tasks = status === undefined
    ? state.tasks.filter((task) => task.status !== "deleted")
    : selectTasks(state, status, completedLimit);
  if (!tasks.length) return "No tasks";
  const lines: string[] = [];
  for (const group of ["in_progress", "pending", "completed", "deleted"] as const) {
    const matching = tasks.filter((task) => task.status === group);
    if (!matching.length) continue;
    lines.push(`── ${group} ──`);
    for (const task of matching) lines.push(`  ${formatTaskLine(state, task)}`);
  }
  return lines.join("\n");
}

export function settleReminderText(state: TodoState): string {
  const tasks = openTasks(state);
  return [SETTLE_REMINDER, ...tasks.map((task) => `#${task.id} [${task.status}] ${plain(task.subject)}`)].join("\n");
}
