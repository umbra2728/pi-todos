import type { TodoAction, TodoParams } from "./types.ts";

const LEGACY_STATUS_ACTIONS: Record<string, TodoAction> = {
  in_progress: "start",
  completed: "complete",
  pending: "reopen",
  deleted: "delete",
};

const NULLABLE_UPDATE_FIELDS = new Set(["description", "activeForm", "owner", "evidence"]);
const OPTIONAL_INPUT_FIELDS = new Set([
  "description",
  "activeForm",
  "owner",
  "evidence",
  "blockedBy",
  "addBlockedBy",
  "removeBlockedBy",
  "tasks",
  "status",
  "completedLimit",
  "id",
  "subject",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function decodeArray(value: unknown): unknown {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  return Array.isArray(parsed) ? parsed : value;
}

function decodeObject(value: unknown): unknown {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  return isRecord(parsed) ? parsed : value;
}

function normalizeBatchItem(value: unknown): unknown {
  const decoded = decodeObject(value);
  if (!isRecord(decoded)) return decoded;
  const item = { ...decoded };
  for (const field of ["description", "blockedBy", "owner"]) {
    if (item[field] === null) delete item[field];
  }
  return item;
}

export function prepareTodoArguments(args: unknown): TodoParams {
  if (!isRecord(args)) return args as TodoParams;
  const input: Record<string, unknown> = { ...args };
  if (input.id === undefined && input.taskId !== undefined) {
    input.id = input.taskId;
    delete input.taskId;
  }
  if (input.id === undefined && input.task_id !== undefined) {
    input.id = input.task_id;
    delete input.task_id;
  }
  if (input.activeForm === undefined && input.active_form !== undefined) {
    input.activeForm = input.active_form;
    delete input.active_form;
  }
  if (input.action === "add") input.action = "create";
  if (input.action === "done") input.action = "complete";
  const matchingLifecycleStatus: Partial<Record<string, string>> = {
    start: "in_progress",
    complete: "completed",
    reopen: "pending",
    delete: "deleted",
  };
  if (typeof input.action === "string" && input.status === matchingLifecycleStatus[input.action]) delete input.status;
  if (input.action === "complete" && input.status === "done") delete input.status;
  if (input.action === "update" && typeof input.status === "string") {
    const action = LEGACY_STATUS_ACTIONS[input.status];
    if (action) {
      input.action = action;
      delete input.status;
    }
  }
  if (input.tasks !== undefined) {
    const tasks = decodeArray(input.tasks);
    input.tasks = Array.isArray(tasks) ? tasks.map(normalizeBatchItem) : tasks;
  }
  for (const [field, value] of Object.entries(input)) {
    if (value !== null || !OPTIONAL_INPUT_FIELDS.has(field)) continue;
    if (input.action === "update" && NULLABLE_UPDATE_FIELDS.has(field)) continue;
    delete input[field];
  }
  if (input.action === "create") {
    for (const field of ["id", "activeForm", "evidence", "addBlockedBy", "removeBlockedBy", "status", "completedLimit"]) {
      delete input[field];
    }
    if (Array.isArray(input.tasks)) {
      for (const field of ["subject", "description", "blockedBy", "owner"]) delete input[field];
    }
  }
  return input as TodoParams;
}
