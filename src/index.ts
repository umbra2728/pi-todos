import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.ts";
import { prepareTodoArguments } from "./normalize.ts";
import { applyMutation, assertActionFields, getBlocks, getTask, openTasks, selectTasks } from "./reducer.ts";
import { TODO_OPERATION_TYPE } from "./replay.ts";
import { TodoOutputSchema, TodoParamsSchema } from "./schema.ts";
import { commitSessionState, evictSession, getSessionState, restoreSession, sessionKey } from "./store.ts";
import type { ListStatus, TodoAction, TodoConfig, TodoParams, TodoToolOutput } from "./types.ts";
import { formatCommandTasks, formatRecovery, formatTaskDetails, formatTaskList, renderOverlay, renderPlainOverlay, settleReminderText } from "./view.ts";

const WIDGET_KEY = "pi-todos";
const REMINDER_TYPE = "pi-todos-settle-reminder";
const RECOVERY_TYPE = "pi-todos-recovery";

const ACTION_GLYPHS: Record<TodoAction, string> = {
  create: "+",
  start: "→",
  complete: "✓",
  reopen: "↶",
  update: "→",
  list: "☰",
  get: "›",
  delete: "×",
  clear_completed: "∅",
  clear_all: "∅",
};

function operationParams(params: TodoParams): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

function textContent(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find((item) => item.type === "text")?.text ?? "";
}

function parseCompletedLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100) throw new Error("completed limit must be an integer from 0 through 100");
  return parsed;
}

export default function piTodos(pi: ExtensionAPI): void {
  let foregroundSession = "";
  let configWarningShown = false;
  const recoverySessions = new Set<string>();
  const remindedSessions = new Set<string>();

  const config = (): TodoConfig => {
    const loaded = loadConfig();
    if (loaded.warning && !configWarningShown) {
      configWarningShown = true;
      console.warn(loaded.warning);
    }
    return loaded.config;
  };

  const refreshOverlay = (ctx: ExtensionContext): void => {
    if (sessionKey(ctx) !== foregroundSession || !ctx.hasUI) return;
    const state = getSessionState(ctx);
    const visible = state.tasks.some((task) => task.status !== "deleted");
    if (!visible) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }
    const currentConfig = config();
    if (ctx.mode === "tui") {
      ctx.ui.setWidget(
        WIDGET_KEY,
        () => ({
          render: (width: number) => renderOverlay(getSessionState(ctx), config(), ctx.ui.theme, width),
          invalidate: () => {},
        }),
        { placement: "aboveEditor" },
      );
      return;
    }
    ctx.ui.setWidget(WIDGET_KEY, renderPlainOverlay(state, currentConfig));
  };

  const restore = (ctx: ExtensionContext): void => {
    const restored = restoreSession(ctx);
    const key = sessionKey(ctx);
    if (foregroundSession === "" && ctx.hasUI) foregroundSession = key;
    if (openTasks(restored.state).length) recoverySessions.add(key);
    else recoverySessions.delete(key);
    for (const warning of restored.warnings) {
      if (ctx.hasUI) ctx.ui.notify(warning, "warning");
      else console.warn(warning);
    }
    refreshOverlay(ctx);
  };

  pi.on("session_start", async (_event, ctx) => restore(ctx));
  pi.on("session_tree", async (_event, ctx) => restore(ctx));
  pi.on("session_compact", async (_event, ctx) => restore(ctx));

  pi.on("session_shutdown", async (_event, ctx) => {
    const key = sessionKey(ctx);
    if (key === foregroundSession && ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
    if (key === foregroundSession) foregroundSession = "";
    recoverySessions.delete(key);
    remindedSessions.delete(key);
    evictSession(ctx);
  });

  pi.on("message_start", async (event, ctx) => {
    if (event.message.role === "user") remindedSessions.delete(sessionKey(ctx));
  });

  pi.on("context", async (event, ctx) => {
    const key = sessionKey(ctx);
    if (!recoverySessions.delete(key)) return undefined;
    const content = formatRecovery(getSessionState(ctx));
    if (!content) return undefined;
    return {
      messages: [
        ...event.messages,
        {
          role: "custom",
          customType: RECOVERY_TYPE,
          content,
          display: false,
          timestamp: Date.now(),
        },
      ],
    };
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    const key = sessionKey(ctx);
    if (event.outcome !== "completed" || remindedSessions.has(key) || !config().settleReminder) return undefined;
    const state = getSessionState(ctx);
    if (!openTasks(state).length) return undefined;
    remindedSessions.add(key);
    return {
      entries: [
        ...event.entries,
        {
          type: "custom_message",
          customType: REMINDER_TYPE,
          content: settleReminderText(state),
          display: false,
        },
      ],
      continue: true,
    };
  });

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description:
      "Track session tasks incrementally by ID. Use start/complete/reopen for lifecycle changes instead of status updates. create appends one task or an initial tasks[] batch; no call replaces the full list.",
    promptSnippet: "Track multi-step work with incremental todo actions by task ID",
    promptGuidelines: [
      "Use todo for complex work with 3+ steps or a user-provided task list; skip trivial single-step work and conversation.",
      "Use todo start before beginning a task and todo complete immediately after verification. start and complete require only the task id; evidence and activeForm are optional.",
      "Use todo reopen to return work to pending. Use todo update only for subject, description, activeForm, owner, evidence, or dependency changes, not for status changes.",
      "Dependencies are real prerequisites: todo start rejects unresolved blockedBy tasks. Multiple tasks may be in_progress and owner is optional.",
      "todo list returns open tasks plus the latest 3 completed by default. Request completed, deleted, or all explicitly when needed; never resend the full list for a mutation.",
    ],
    parameters: TodoParamsSchema,
    outputSchema: TodoOutputSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    prepareArguments: prepareTodoArguments,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      assertActionFields(params as TodoParams);
      const state = getSessionState(ctx);
      if (params.action === "list") {
        const tasks = selectTasks(state, params.status, params.completedLimit ?? config().completedInList);
        const output: TodoToolOutput = { action: "list", tasks, count: tasks.length };
        return {
          content: [{ type: "text", text: formatTaskList(state, tasks) }],
          details: output,
          structuredContent: output as unknown as JsonValue,
        };
      }
      if (params.action === "get") {
        if (params.id === undefined) throw new Error("id required for get");
        const task = getTask(state, params.id);
        const blocks = getBlocks(state, task.id);
        const output: TodoToolOutput = { action: "get", task, ...(blocks.length ? { blocks } : {}) };
        return {
          content: [{ type: "text", text: formatTaskDetails(state, task) }],
          details: output,
          structuredContent: output as unknown as JsonValue,
        };
      }
      const at = new Date().toISOString();
      const applied = applyMutation(state, params as TodoParams, at);
      if (applied.changed) {
        pi.appendEntry(TODO_OPERATION_TYPE, {
          version: 1,
          at,
          action: params.action,
          params: operationParams(params as TodoParams),
        });
        commitSessionState(ctx, applied.state);
        refreshOverlay(ctx);
      }
      const output: TodoToolOutput = {
        action: params.action,
        ids: applied.ids,
        changed: applied.changed,
        ...(applied.status ? { status: applied.status } : {}),
        ...(!applied.ids.length || params.action === "clear_completed" || params.action === "clear_all" ? { count: applied.ids.length } : {}),
      };
      return {
        content: [{ type: "text", text: applied.message }],
        details: output,
        structuredContent: output as unknown as JsonValue,
      };
    },
    renderCall(args, theme) {
      const action = args.action as TodoAction | undefined;
      const id = typeof args.id === "number" ? ` #${args.id}` : "";
      const subject = typeof args.subject === "string" ? ` ${args.subject}` : "";
      const batch = Array.isArray(args.tasks) ? ` ${args.tasks.length} tasks` : "";
      return new Text(`${theme.fg("toolTitle", theme.bold("todo"))} ${theme.fg("muted", action ? ACTION_GLYPHS[action] : "…")}${id}${subject}${batch}`, 0, 0);
    },
    renderResult(result, _options, theme, context) {
      const output = result.details as TodoToolOutput | undefined;
      if (context.isError) return new Text(theme.fg("error", `✗ ${textContent(result)}`), 0, 0);
      if (output?.status) {
        const color = output.status === "completed" ? "success" : output.status === "deleted" ? "error" : "warning";
        return new Text(theme.fg(color, textContent(result)), 0, 0);
      }
      return new Text(theme.fg("success", `✓ ${textContent(result)}`), 0, 0);
    },
  });

  pi.registerCommand("todos", {
    description: "Show todos: open, pending, in_progress, completed [limit], deleted, or all",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/todos requires interactive mode", "error");
        return;
      }
      const state = getSessionState(ctx);
      const [rawFilter, rawLimit, extra] = args.trim().split(/\s+/).filter(Boolean);
      if (extra) {
        ctx.ui.notify("Usage: /todos [open|pending|in_progress|completed [limit]|deleted|all]", "warning");
        return;
      }
      try {
        if (rawLimit !== undefined && rawFilter !== "completed") {
          ctx.ui.notify("A limit is accepted only after completed", "warning");
          return;
        }
        if (rawFilter === "open") {
          const openState = { ...state, tasks: openTasks(state) };
          ctx.ui.notify(formatCommandTasks(openState), "info");
          return;
        }
        const allowed = new Set(["pending", "in_progress", "completed", "deleted", "all"]);
        if (rawFilter && !allowed.has(rawFilter)) {
          ctx.ui.notify("Usage: /todos [open|pending|in_progress|completed [limit]|deleted|all]", "warning");
          return;
        }
        const limit = parseCompletedLimit(rawLimit, config().completedInList);
        ctx.ui.notify(formatCommandTasks(state, rawFilter as ListStatus | undefined, limit), "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
      }
    },
  });
}
