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

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
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
  if (isAbsent(item.subject) && item.title !== undefined) {
    item.subject = item.title;
    delete item.title;
  } else if (isAbsent(item.subject) && item.content !== undefined) {
    item.subject = item.content;
    delete item.content;
  }
  if (isAbsent(item.activeForm) && item.active_form !== undefined) {
    item.activeForm = item.active_form;
    delete item.active_form;
  }
  if (isAbsent(item.blockedBy) && item.dependsOn !== undefined) {
    item.blockedBy = item.dependsOn;
    delete item.dependsOn;
  }
  for (const field of ["id", "taskId", "task_id", "status", "evidence"]) delete item[field];
  for (const field of ["description", "activeForm", "blockedBy", "owner"]) {
    if (item[field] === null) delete item[field];
  }
  return item;
}

export function prepareTodoArguments(args: unknown): TodoParams {
  if (!isRecord(args)) return args as TodoParams;
  const input: Record<string, unknown> = { ...args };
  if (isAbsent(input.id) && input.taskId !== undefined) {
    input.id = input.taskId;
    delete input.taskId;
  }
  if (isAbsent(input.id) && input.task_id !== undefined) {
    input.id = input.task_id;
    delete input.task_id;
  }
  if (isAbsent(input.activeForm) && input.active_form !== undefined) {
    input.activeForm = input.active_form;
    delete input.active_form;
  }
  if (input.action === "add") input.action = "create";
  if (input.action === "done") input.action = "complete";
  if (input.action === "remove") input.action = "delete";
  if (input.action === "create" && isAbsent(input.subject)) {
    if (input.title !== undefined) {
      input.subject = input.title;
      delete input.title;
    } else if (input.content !== undefined) {
      input.subject = input.content;
      delete input.content;
    }
  }
  if (input.action === "create" && isAbsent(input.blockedBy) && input.dependsOn !== undefined) {
    input.blockedBy = input.dependsOn;
    delete input.dependsOn;
  }
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
    for (const field of ["id", "evidence", "addBlockedBy", "removeBlockedBy", "status", "completedLimit"]) {
      delete input[field];
    }
    if (Array.isArray(input.tasks)) {
      for (const field of ["subject", "description", "activeForm", "blockedBy", "owner"]) delete input[field];
    }
  }
  return input as TodoParams;
}
