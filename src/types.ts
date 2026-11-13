export const TASK_STATUSES = ["pending", "in_progress", "completed", "deleted"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type VisibleTaskStatus = Exclude<TaskStatus, "deleted">;

export const TODO_ACTIONS = [
  "create",
  "start",
  "complete",
  "reopen",
  "update",
  "list",
  "get",
  "delete",
  "clear_completed",
  "clear_all",
] as const;

export type TodoAction = (typeof TODO_ACTIONS)[number];
export type MutationAction = Exclude<TodoAction, "list" | "get">;
export type ListStatus = TaskStatus | "all";

export interface Task {
  id: number;
  subject: string;
  description?: string;
  status: TaskStatus;
  activeForm?: string;
  owner?: string;
  evidence?: string;
  blockedBy?: number[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CreateTaskInput {
  subject: string;
  description?: string | null;
  activeForm?: string | null;
  blockedBy?: number[];
  owner?: string | null;
}

export interface TodoParams {
  action: TodoAction;
  id?: number;
  subject?: string;
  description?: string | null;
  activeForm?: string | null;
  owner?: string | null;
  evidence?: string | null;
  blockedBy?: number[];
  addBlockedBy?: number[];
  removeBlockedBy?: number[];
  tasks?: CreateTaskInput[];
  status?: ListStatus;
  completedLimit?: number;
  [key: string]: unknown;
}

export interface TodoState {
  tasks: Task[];
  nextId: number;
}

export interface TodoOperationEntry {
  version: 1;
  at: string;
  action: MutationAction;
  params: Record<string, unknown>;
}

export interface MutationResult {
  state: TodoState;
  ids: number[];
  changed: boolean;
  status?: TaskStatus;
  message: string;
}

export interface TodoConfig {
  completedInList: number;
  completedInOverlay: number;
  maxOverlayLines: number;
  settleReminder: boolean;
}

export interface TodoToolOutput {
  action: TodoAction;
  ids?: number[];
  changed?: boolean;
  status?: TaskStatus;
  tasks?: Task[];
  task?: Task;
  blocks?: number[];
  count?: number;
}

export class TodoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoError";
  }
}
