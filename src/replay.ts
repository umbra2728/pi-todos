import { applyMutation, createEmptyState } from "./reducer.ts";
import { TODO_ACTIONS } from "./types.ts";
import type { MutationAction, TodoParams, TodoState } from "./types.ts";

export const TODO_OPERATION_TYPE = "pi-todos-operation";

const MUTATION_ACTIONS = new Set(TODO_ACTIONS.filter((action) => action !== "list" && action !== "get"));

export interface ReplayResult {
  state: TodoState;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function replayOperations(entries: Iterable<unknown>): ReplayResult {
  let state = createEmptyState();
  const warnings: string[] = [];
  let index = 0;
  for (const raw of entries) {
    if (!isRecord(raw) || raw.type !== "custom" || raw.customType !== TODO_OPERATION_TYPE) continue;
    index += 1;
    try {
      const entry = raw.data;
      if (!isRecord(entry) || entry.version !== 1 || typeof entry.at !== "string" || !entry.at) {
        throw new Error("invalid operation envelope");
      }
      if (typeof entry.action !== "string" || !MUTATION_ACTIONS.has(entry.action as never)) {
        throw new Error("invalid operation action");
      }
      if (!isRecord(entry.params)) throw new Error("invalid operation params");
      const params = { ...entry.params, action: entry.action } as TodoParams;
      const applied = applyMutation(state, params, entry.at);
      state = applied.state;
    } catch (error) {
      const id = typeof raw.id === "string" ? raw.id : String(index);
      warnings.push(`Skipped invalid todo operation ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { state, warnings };
}
