import { TASK_STATUSES, TodoError } from "./types.ts";
import type {
  CreateTaskInput,
  ListStatus,
  MutationResult,
  Task,
  TaskStatus,
  TodoAction,
  TodoParams,
  TodoState,
} from "./types.ts";

const ACTION_FIELDS: Record<TodoAction, ReadonlySet<string>> = {
  create: new Set(["subject", "description", "blockedBy", "owner", "tasks"]),
  start: new Set(["id", "activeForm"]),
  complete: new Set(["id", "evidence"]),
  reopen: new Set(["id"]),
  update: new Set(["id", "subject", "description", "activeForm", "owner", "evidence", "addBlockedBy", "removeBlockedBy"]),
  list: new Set(["status", "completedLimit"]),
  get: new Set(["id"]),
  delete: new Set(["id"]),
  clear_completed: new Set(),
  clear_all: new Set(),
};

const MUTATION_ACTIONS = new Set(["create", "start", "complete", "reopen", "update", "delete", "clear_completed", "clear_all"]);

export function createEmptyState(): TodoState {
  return { tasks: [], nextId: 1 };
}

function cloneTask(task: Task): Task {
  return { ...task, ...(task.blockedBy ? { blockedBy: [...task.blockedBy] } : {}) };
}

function cloneState(state: TodoState): TodoState {
  return { tasks: state.tasks.map(cloneTask), nextId: state.nextId };
}

export function assertActionFields(params: TodoParams): void {
  const allowed = ACTION_FIELDS[params.action];
  if (!allowed) throw new TodoError(`Unknown action: ${String(params.action)}`);
  for (const [field, value] of Object.entries(params)) {
    if (field === "action" || value === undefined) continue;
    if (!allowed.has(field)) throw new TodoError(`${field} is not supported for ${params.action}`);
  }
}

function requireId(params: TodoParams): number {
  if (!Number.isSafeInteger(params.id) || (params.id ?? 0) < 1) throw new TodoError(`id required for ${params.action}`);
  return params.id as number;
}

function findAny(state: TodoState, id: number): Task {
  const task = state.tasks.find((candidate) => candidate.id === id);
  if (!task) throw new TodoError(`#${id} not found`);
  return task;
}

function findMutable(state: TodoState, id: number): Task {
  const task = findAny(state, id);
  if (task.status === "deleted") throw new TodoError(`#${id} is deleted`);
  return task;
}

function cleanText(value: string | null | undefined, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new TodoError(`${field} must be a string or null`);
  const text = value.trim();
  return text || undefined;
}

function cleanIds(value: number[] | undefined, field: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TodoError(`${field} must be an array of task IDs`);
  for (const id of value) {
    if (!Number.isSafeInteger(id) || id < 1) throw new TodoError(`${field} contains an invalid task ID`);
  }
  return [...new Set(value)];
}

function validateDependencies(state: TodoState, ownerId: number, blockedBy: number[], siblingIds: ReadonlySet<number>): void {
  for (const id of blockedBy) {
    if (id === ownerId) throw new TodoError(`cannot block #${ownerId} on itself`);
    if (siblingIds.has(id)) {
      if (id < ownerId) continue;
      throw new TodoError(`blockedBy: #${id} must reference an earlier batch item`);
    }
    const dependency = state.tasks.find((task) => task.id === id);
    if (!dependency) throw new TodoError(`blockedBy: #${id} not found`);
    if (dependency.status === "deleted") throw new TodoError(`blockedBy: #${id} is deleted`);
  }
}

function detectCycle(tasks: Task[], currentId: number, nextBlockedBy: number[]): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const current = byId.get(currentId);
  if (current) byId.set(currentId, { ...current, blockedBy: nextBlockedBy });
  const visited = new Set<number>();
  const visit = (id: number): boolean => {
    if (id === currentId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    const task = byId.get(id);
    if (!task || task.status === "deleted") return false;
    return (task.blockedBy ?? []).some(visit);
  };
  return nextBlockedBy.some(visit);
}

function sameTask(left: Task, right: Task): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function replaceTask(state: TodoState, updated: Task): TodoState {
  return {
    tasks: state.tasks.map((task) => (task.id === updated.id ? updated : task)),
    nextId: state.nextId,
  };
}

function result(state: TodoState, before: TodoState, ids: number[], message: string, status?: TaskStatus): MutationResult {
  const changed = JSON.stringify(state) !== JSON.stringify(before);
  return { state: changed ? state : before, ids, changed, ...(status ? { status } : {}), message: changed ? message : "No change" };
}

function createTasks(state: TodoState, params: TodoParams, at: string): MutationResult {
  if (params.tasks !== undefined && params.subject !== undefined) throw new TodoError("create requires subject or tasks[], not both");
  if (params.tasks !== undefined) {
    for (const field of ["description", "blockedBy", "owner"]) {
      if (params[field] !== undefined) throw new TodoError(`create with tasks[] takes ${field} on each item, not at the top level`);
    }
  }
  const rawItems = params.tasks ?? [{ subject: params.subject, description: params.description, blockedBy: params.blockedBy, owner: params.owner }];
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new TodoError("subject required for create");
  const siblingIds = new Set(rawItems.map((_, index) => state.nextId + index));
  const specs = rawItems.map((raw, index): CreateTaskInput => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TodoError(`tasks[${index}] must be an object`);
    const spec = raw as CreateTaskInput;
    if (typeof spec.subject !== "string" || !spec.subject.trim()) throw new TodoError(`tasks[${index}]: subject required for create`);
    return spec;
  });
  const created = specs.map((spec, index): Task => {
    const id = state.nextId + index;
    const blockedBy = cleanIds(spec.blockedBy, "blockedBy");
    validateDependencies(state, id, blockedBy, siblingIds);
    const description = cleanText(spec.description, "description");
    const owner = cleanText(spec.owner, "owner");
    return {
      id,
      subject: spec.subject.trim(),
      status: "pending",
      ...(description ? { description } : {}),
      ...(owner ? { owner } : {}),
      ...(blockedBy.length ? { blockedBy } : {}),
      createdAt: at,
    };
  });
  const next = { tasks: [...state.tasks, ...created], nextId: state.nextId + created.length };
  return result(next, state, created.map((task) => task.id), created.length === 1 ? `Created #${created[0]!.id}` : `Created ${created.length} tasks`, "pending");
}

function unresolvedDependencies(state: TodoState, task: Task): number[] {
  return (task.blockedBy ?? []).filter((id) => {
    const dependency = state.tasks.find((candidate) => candidate.id === id);
    return !dependency || (dependency.status !== "completed" && dependency.status !== "deleted");
  });
}

function startTask(state: TodoState, params: TodoParams, at: string): MutationResult {
  const current = findMutable(state, requireId(params));
  const updated = cloneTask(current);
  if (params.activeForm !== undefined) {
    const activeForm = cleanText(params.activeForm, "activeForm");
    if (activeForm) updated.activeForm = activeForm;
    else delete updated.activeForm;
  }
  if (updated.status === "in_progress" && sameTask(current, updated)) {
    return result(state, state, [current.id], "No change", "in_progress");
  }
  const unresolved = unresolvedDependencies(state, current);
  if (unresolved.length) {
    const blockers = unresolved.map((id) => {
      const dependency = state.tasks.find((task) => task.id === id);
      return dependency ? `#${id} (${dependency.subject})` : `#${id} (missing)`;
    });
    throw new TodoError(`#${current.id} is blocked by ${blockers.join(", ")}`);
  }
  if (updated.status !== "in_progress") {
    updated.status = "in_progress";
    updated.startedAt = at;
    delete updated.completedAt;
    delete updated.evidence;
  }
  return result(replaceTask(state, updated), state, [current.id], `Started #${current.id}`, updated.status);
}

function completeTask(state: TodoState, params: TodoParams, at: string): MutationResult {
  const current = findMutable(state, requireId(params));
  const updated = cloneTask(current);
  if (updated.status !== "completed") {
    updated.status = "completed";
    updated.completedAt = at;
  }
  if (params.evidence !== undefined) {
    const evidence = cleanText(params.evidence, "evidence");
    if (evidence) updated.evidence = evidence;
    else delete updated.evidence;
  }
  return result(replaceTask(state, updated), state, [current.id], `Completed #${current.id}`, "completed");
}

function reopenTask(state: TodoState, params: TodoParams): MutationResult {
  const current = findMutable(state, requireId(params));
  const updated = cloneTask(current);
  updated.status = "pending";
  delete updated.completedAt;
  delete updated.evidence;
  return result(replaceTask(state, updated), state, [current.id], `Reopened #${current.id}`, "pending");
}

function updateTask(state: TodoState, params: TodoParams): MutationResult {
  const current = findMutable(state, requireId(params));
  const hasMutation =
    params.subject !== undefined ||
    params.description !== undefined ||
    params.activeForm !== undefined ||
    params.owner !== undefined ||
    params.evidence !== undefined ||
    cleanIds(params.addBlockedBy, "addBlockedBy").length > 0 ||
    cleanIds(params.removeBlockedBy, "removeBlockedBy").length > 0;
  if (!hasMutation) throw new TodoError("update requires at least one mutable field");
  const updated = cloneTask(current);
  if (params.subject !== undefined) {
    const subject = cleanText(params.subject, "subject");
    if (!subject) throw new TodoError("subject cannot be empty");
    updated.subject = subject;
  }
  for (const field of ["description", "activeForm", "owner", "evidence"] as const) {
    if (params[field] === undefined) continue;
    const value = cleanText(params[field], field);
    if (value) updated[field] = value;
    else delete updated[field];
  }
  let blockedBy = [...(updated.blockedBy ?? [])];
  const removals = new Set(cleanIds(params.removeBlockedBy, "removeBlockedBy"));
  blockedBy = blockedBy.filter((id) => !removals.has(id));
  const additions = cleanIds(params.addBlockedBy, "addBlockedBy");
  validateDependencies(state, current.id, additions, new Set());
  for (const id of additions) if (!blockedBy.includes(id)) blockedBy.push(id);
  if (detectCycle(state.tasks, current.id, blockedBy)) throw new TodoError("addBlockedBy would create a cycle");
  if (blockedBy.length) updated.blockedBy = blockedBy;
  else delete updated.blockedBy;
  if (sameTask(current, updated)) return result(state, state, [current.id], "No change", current.status);
  return result(replaceTask(state, updated), state, [current.id], `Updated #${current.id}`, current.status);
}

function deleteTask(state: TodoState, params: TodoParams): MutationResult {
  const current = findAny(state, requireId(params));
  if (current.status === "deleted") return result(state, state, [current.id], "No change", "deleted");
  const updated = { ...cloneTask(current), status: "deleted" as const };
  return result(replaceTask(state, updated), state, [current.id], `Deleted #${current.id}`, "deleted");
}

function clearCompleted(state: TodoState): MutationResult {
  const removed = new Set(state.tasks.filter((task) => task.status === "completed").map((task) => task.id));
  if (!removed.size) return result(state, state, [], "No change");
  const tasks = state.tasks
    .filter((task) => !removed.has(task.id))
    .map((task) => {
      if (!task.blockedBy) return cloneTask(task);
      const blockedBy = task.blockedBy.filter((id) => !removed.has(id));
      const updated = cloneTask(task);
      if (blockedBy.length) updated.blockedBy = blockedBy;
      else delete updated.blockedBy;
      return updated;
    });
  return result({ tasks, nextId: state.nextId }, state, [...removed], `Cleared ${removed.size} completed tasks`);
}

function clearAll(state: TodoState): MutationResult {
  if (!state.tasks.length && state.nextId === 1) return result(state, state, [], "No change");
  const ids = state.tasks.map((task) => task.id);
  return result(createEmptyState(), state, ids, "Cleared all tasks");
}

export function applyMutation(state: TodoState, params: TodoParams, at: string): MutationResult {
  assertActionFields(params);
  if (!MUTATION_ACTIONS.has(params.action)) throw new TodoError(`${params.action} is not a mutation`);
  const before = cloneState(state);
  let applied: MutationResult;
  switch (params.action) {
    case "create":
      applied = createTasks(before, params, at);
      break;
    case "start":
      applied = startTask(before, params, at);
      break;
    case "complete":
      applied = completeTask(before, params, at);
      break;
    case "reopen":
      applied = reopenTask(before, params);
      break;
    case "update":
      applied = updateTask(before, params);
      break;
    case "delete":
      applied = deleteTask(before, params);
      break;
    case "clear_completed":
      applied = clearCompleted(before);
      break;
    case "clear_all":
      applied = clearAll(before);
      break;
    default:
      throw new TodoError(`Unknown action: ${String(params.action)}`);
  }
  return applied.changed ? applied : { ...applied, state };
}

function recentCompleted(state: TodoState, limit: number): Task[] {
  return state.tasks
    .filter((task) => task.status === "completed")
    .sort((left, right) => right.completedAt?.localeCompare(left.completedAt ?? "") || right.createdAt.localeCompare(left.createdAt) || right.id - left.id)
    .slice(0, limit)
    .map(cloneTask);
}

export function selectTasks(state: TodoState, status?: ListStatus, completedLimit = 3): Task[] {
  if (status === "all") return state.tasks.map(cloneTask);
  if (status === "deleted") return state.tasks.filter((task) => task.status === "deleted").map(cloneTask);
  if (status === "completed") return recentCompleted(state, completedLimit);
  if (status === "pending" || status === "in_progress") {
    return state.tasks.filter((task) => task.status === status).map(cloneTask);
  }
  return [
    ...state.tasks.filter((task) => task.status === "pending" || task.status === "in_progress").map(cloneTask),
    ...recentCompleted(state, completedLimit),
  ];
}

export function getTask(state: TodoState, id: number): Task {
  return cloneTask(findAny(state, id));
}

export function getBlocks(state: TodoState, id: number): number[] {
  return state.tasks.filter((task) => task.status !== "deleted" && task.blockedBy?.includes(id)).map((task) => task.id);
}

export function openTasks(state: TodoState): Task[] {
  return state.tasks.filter((task) => task.status === "pending" || task.status === "in_progress").map(cloneTask);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUSES.includes(value as TaskStatus);
}
