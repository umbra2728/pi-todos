import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { TASK_STATUSES, TODO_ACTIONS } from "./types.ts";
import type { ListStatus, TodoAction } from "./types.ts";

const NullableText = Type.Union([Type.String(), Type.Null()]);
const TaskIds = Type.Array(Type.Integer({ minimum: 1 }));

const CreateTaskSchema = Type.Object(
  {
    subject: Type.String({ description: "Short imperative task title" }),
    description: Type.Optional(NullableText),
    activeForm: Type.Optional(NullableText),
    blockedBy: Type.Optional(TaskIds),
    owner: Type.Optional(NullableText),
  },
  { additionalProperties: false },
);

export const TodoParamsSchema = Type.Object(
  {
    action: Type.Unsafe<TodoAction>(
      StringEnum(
        ["create", "start", "complete", "reopen", "update", "list", "get", "delete", "clear_completed", "clear_all"] as const,
        { description: "Lifecycle or query operation. Use start/complete/reopen instead of passing status updates." },
      ),
    ),
    id: Type.Optional(Type.Integer({ minimum: 1, description: "Task ID" })),
    subject: Type.Optional(Type.String({ description: "Short imperative task title for create or update" })),
    description: Type.Optional(NullableText),
    activeForm: Type.Optional(NullableText),
    owner: Type.Optional(NullableText),
    evidence: Type.Optional(NullableText),
    blockedBy: Type.Optional(TaskIds),
    addBlockedBy: Type.Optional(TaskIds),
    removeBlockedBy: Type.Optional(TaskIds),
    tasks: Type.Optional(
      Type.Array(CreateTaskSchema, {
        description: "Initial batch creation only. Appends new tasks; never replaces the current list.",
      }),
    ),
    status: Type.Optional(
      Type.Unsafe<ListStatus>(
        StringEnum(["pending", "in_progress", "completed", "deleted", "all"] as const, {
          description: "Filter for list. Legacy update+status calls normalize to lifecycle actions before validation.",
        }),
      ),
    ),
    completedLimit: Type.Optional(
      Type.Integer({ minimum: 0, maximum: 100, description: "Recent completed tasks to return; default 3" }),
    ),
  },
  { additionalProperties: false },
);

export const TaskOutputSchema = Type.Object({
  id: Type.Integer(),
  subject: Type.String(),
  description: Type.Optional(Type.String()),
  status: StringEnum(TASK_STATUSES),
  activeForm: Type.Optional(Type.String()),
  owner: Type.Optional(Type.String()),
  evidence: Type.Optional(Type.String()),
  blockedBy: Type.Optional(Type.Array(Type.Integer())),
  createdAt: Type.String(),
  startedAt: Type.Optional(Type.String()),
  completedAt: Type.Optional(Type.String()),
});

export const TodoOutputSchema = Type.Object({
  action: StringEnum(TODO_ACTIONS),
  ids: Type.Optional(Type.Array(Type.Integer())),
  changed: Type.Optional(Type.Boolean()),
  status: Type.Optional(StringEnum(TASK_STATUSES)),
  tasks: Type.Optional(Type.Array(TaskOutputSchema)),
  task: Type.Optional(TaskOutputSchema),
  blocks: Type.Optional(Type.Array(Type.Integer())),
  count: Type.Optional(Type.Integer()),
});
