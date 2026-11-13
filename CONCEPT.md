# pi-todos concept

## Goal

`pi-todos` is a session-native task tracker for Pi that is reliable with imperfect tool-calling models and efficient in long sessions.

The main design decisions are:

- One model-facing tool named `todo`.
- Incremental updates by numeric task ID. The model never resends the full list to change a task.
- Dedicated `start`, `complete`, and `reopen` actions. Normal status changes do not require a `status` argument.
- Three working statuses plus a hidden `deleted` tombstone.
- Multiple tasks may be `in_progress`; `owner` is optional.
- State lives only in Pi session-branch entries. No project task files and no migration from other todo extensions.
- An operation journal instead of a full snapshot after every mutation.
- All user-facing and model-facing text is English.
- No comments in source code.

## Non-goals

- Full-list replacement on every update.
- Project-shared task storage.
- Migration from `rpiv-todo` or other extensions.
- `failed`, `deferred`, `blocked`, or `cancelled` statuses.
- Required completion evidence.
- Priority, arbitrary metadata, or manual task reordering.
- Interactive task editing through `/todos`.
- Autonomous repeated continuation until every task is complete.
- Automatic task completion based on assistant prose or background-process state.

## Task model

```ts
type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

interface Task {
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
```

Rules:

- IDs are positive integers allocated sequentially within the session branch.
- `subject` is a short nonblank imperative title.
- `description` is optional long-form context.
- `activeForm` is an optional present-continuous label displayed only for active work.
- `owner` is optional and has no lifecycle side effects.
- `evidence` is optional free text such as a test result or commit.
- `createdAt` is immutable.
- `startedAt` records the latest start.
- `completedAt` records the latest completion and is cleared by `start` and `reopen`.
- Reopening a task clears stale `evidence`.
- Tasks retain creation order. Recent-completed views sort by `completedAt` descending.
- `deleted` is terminal for all mutations except `clear_all`.

## Tool surface

The extension registers one tool named `todo`, with `executionMode: "sequential"` to prevent lost updates from parallel calls sharing session state.

### Create one task

```json
{
  "action": "create",
  "subject": "Inspect the existing implementation",
  "description": "Read the reducer, schema, and replay logic",
  "blockedBy": [2],
  "owner": "researcher"
}
```

`description`, `blockedBy`, and `owner` are optional. New tasks start as `pending`.

### Create an initial batch atomically

```json
{
  "action": "create",
  "tasks": [
    {
      "subject": "Inspect the existing implementation"
    },
    {
      "subject": "Implement incremental updates"
    },
    {
      "subject": "Verify the behavior"
    }
  ]
}
```

Batch rules:

- `subject` and `tasks` are mutually exclusive.
- `tasks` must be nonempty.
- All items are validated before any item is committed.
- Items receive sequential IDs.
- A batch item may depend on an existing task, but not on a sibling created by the same batch.
- Top-level single-create fields are rejected when `tasks` is present.
- Batch creation appends tasks; it never replaces existing tasks.

### Start work

```json
{
  "action": "start",
  "id": 3,
  "activeForm": "implementing incremental updates"
}
```

`activeForm` is optional. `start` rejects unresolved dependencies and names the blocking IDs and subjects.

### Complete work

```json
{
  "action": "complete",
  "id": 3,
  "evidence": "npm test: 38 passed"
}
```

`evidence` is optional.

### Reopen work

```json
{
  "action": "reopen",
  "id": 3
}
```

### Edit fields without changing status

```json
{
  "action": "update",
  "id": 3,
  "description": "Updated acceptance criteria",
  "owner": "implementer",
  "addBlockedBy": [1],
  "removeBlockedBy": [2]
}
```

Mutable fields:

- `subject`
- `description`
- `activeForm`
- `owner`
- `evidence`
- `addBlockedBy`
- `removeBlockedBy`

`description`, `activeForm`, `owner`, and `evidence` accept `null` to clear the field. At least one actual mutation is required. Empty dependency arrays alone do not count as a mutation.

`update` does not accept `status`, timestamps, `tasks`, `includeDeleted`, or ID changes.

### List tasks

```json
{
  "action": "list"
}
```

With no filter, the result contains:

- every `pending` and `in_progress` task in creation order;
- the three most recently completed tasks;
- no deleted tasks.

Optional filters:

```ts
{
  status?: "pending" | "in_progress" | "completed" | "deleted" | "all";
  completedLimit?: number;
}
```

- `completedLimit` defaults to `3` and accepts integers from `0` through `100`.
- `status: "completed"` selects completed tasks and honors `completedLimit`.
- `status: "deleted"` selects all tombstones.
- `status: "all"` returns the complete list, including deleted tasks, without a completed limit.

This keeps forty or more completed tasks out of normal model context while retaining them in session state.

### Get one task

```json
{
  "action": "get",
  "id": 3
}
```

The result includes the complete task and reverse `blocks` edges.

### Delete a task

```json
{
  "action": "delete",
  "id": 3
}
```

Deletion sets `status: "deleted"` and hides the task from normal views. A deleted dependency no longer blocks its dependants. Adding a deleted task as a new dependency is rejected.

### Prune completed tasks

```json
{
  "action": "clear_completed"
}
```

This physically removes completed tasks and removes their IDs from remaining `blockedBy` arrays. IDs and the next-ID counter are not reset.

### Clear the list

```json
{
  "action": "clear_all"
}
```

This removes every task and resets the next ID to `1`. There is no ambiguous generic `clear` action.

## Lifecycle semantics

Transitions are deliberately tolerant:

- `start` changes any non-deleted task to `in_progress`.
- `complete` changes any non-deleted task to `completed`.
- `reopen` changes any non-deleted task to `pending`.
- A repeated action with identical values returns `No change` instead of an error.
- A repeated `start` may update `activeForm`.
- A repeated `complete` may add or replace `evidence`.
- `start` and `reopen` clear `completedAt` and stale `evidence`.
- Deleted tasks reject all mutations.

Dependency validation remains strict:

- `start` is rejected while any non-deleted dependency is not completed.
- Unknown, deleted, and self dependencies are rejected when adding edges.
- Cycles are rejected before state changes.
- Deleting a blocker makes that edge inactive.
- Pruning a completed task removes its edges from remaining tasks.

## Validation and repair

The public schema uses `additionalProperties: false` at the root and inside batch items.

Every action has an explicit field whitelist. An action-inapplicable field rejects the call before mutation, for example:

```text
includeDeleted is not supported for update
```

Failures use real tool errors rather than successful no-op results. Messages include the invalid field and the expected call shape when useful.

`prepareArguments` performs only high-confidence repairs before schema validation:

- `taskId` and `task_id` to `id`;
- `active_form` to `activeForm`;
- `add` to `create` and `done` to `complete`;
- legacy `update` with `status: "in_progress"` to `start`;
- legacy `update` with `status: "completed"` to `complete`;
- legacy `update` with `status: "pending"` to `reopen`;
- legacy `update` with `status: "deleted"` to `delete`;
- double-encoded `tasks` arrays and batch-item objects produced by some providers.

The plugin never guesses a missing status or invents a mutation. Unknown or malformed keys such as `status”` are rejected.

Provider-side constrained sampling is requested with:

```ts
{
  type: "json_schema",
  strict: "prefer"
}
```

Unsupported providers fall back to the normal Pi schema path.

## Tool results and codemode

Every action declares structured output. Codemode receives plain objects rather than formatted text.

Mutation results include the action, affected IDs, changed flag, and resulting status. They do not include the full task list.

`list` returns only the selected tasks. `get` returns one task. Human-readable `content` remains available for normal model calls.

## Session persistence

State is stored in custom session entries:

```ts
interface TodoOperationEntry {
  version: 1;
  at: string;
  action: TodoAction;
  params: Record<string, unknown>;
}
```

Each successful actual mutation appends one `pi-todos-operation` entry through `pi.appendEntry`.

Properties:

- Entries contain only the operation, not the full task list.
- `at` makes timestamps deterministic during replay.
- Reads, rejected calls, and exact no-op calls append nothing.
- Calls made through codemode persist through the same path.
- The next-ID counter is derived during replay.
- A `clear_all` operation starts a fresh logical history without requiring deletion of old session entries.
- Entry versioning allows a future replay format migration.

On `session_start`, `session_tree`, and `session_compact`, the extension replays operations from the active branch into a per-session in-memory state. Parallel and child sessions have independent state and cannot overwrite one another.

Malformed journal entries do not silently replace valid state with an empty list. Replay reports a recovery warning and preserves the last valid recoverable state.

No migration from `rpiv-todo-state` is performed. If no `pi-todos-operation` entries exist, the list starts empty.

## Compaction and restore recovery

When a session with open tasks is restored or compacted, the next model request receives one compact context reminder containing only `pending` and `in_progress` tasks:

```text
Current open tasks from the todo list:
#3 [in_progress] Implement incremental updates
#4 [pending] Verify the behavior
Reconcile these statuses with actual progress before changing them.
```

The reminder is injected once, is not repeatedly appended to history, and contains no completed-task backlog.

## Settle reminder

If an agent attempts to settle with open tasks, the extension requests one reconciliation continuation per genuine user prompt.

The reminder is:

```text
Review the open tasks before finishing. If you are intentionally pausing to ask the user a question, waiting for input, or leaving background work running, keep their statuses unchanged and finish normally. Otherwise, continue working and complete the remaining tasks. Reconcile any completed work with the todo list before finishing.
```

Behavior:

- The open tasks are appended below this text.
- The continuation is requested through `agent_before_settle` with `continue: true`.
- The reminder is hidden from the user.
- The flag resets on a genuine new user message, not on `agent_start`, so the reconciliation continuation cannot retrigger itself.
- Aborted runs do not request continuation.
- There is no repeated autonomous loop and no automatic status mutation.

## Overlay

A live overlay above the editor shows:

- a `Todos done/total` heading;
- open tasks in creation order;
- the three most recently completed tasks;
- no deleted tasks.

Rows include ID, subject, status glyph, optional active form, owner, and unresolved dependencies. Completed subjects are dimmed and struck through.

The default budget is twelve content rows. Completed rows are dropped first on overflow, then the open-task window is truncated with an exact `+N more` summary. The overlay disappears when no visible tasks remain.

Only the foreground session refreshes the shared overlay. Child sessions keep their own state without rebinding the foreground UI.

## `/todos` command

`/todos` is read-only and supports:

```text
/todos
/todos open
/todos pending
/todos in_progress
/todos completed [limit]
/todos deleted
/todos all
```

With no arguments it shows every non-deleted task grouped by status. It never edits state and reports a clear message in headless mode.

## Configuration

No configuration is required. Optional JSON lives at `~/.pi/agent/pi-todos.json`:

```json
{
  "completedInList": 3,
  "completedInOverlay": 3,
  "maxOverlayLines": 12,
  "settleReminder": true
}
```

Malformed values fall back to defaults with a warning. Configuration is read when needed, so changes do not require `/reload`.

## Package structure

```text
pi-todos/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── scripts/
│   └── check_no_comments.py
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── normalize.ts
│   ├── reducer.ts
│   ├── replay.ts
│   ├── schema.ts
│   ├── store.ts
│   ├── types.ts
│   └── view.ts
├── test/
│   ├── normalize.test.ts
│   ├── reducer.test.ts
│   ├── replay.test.ts
│   ├── reminders.test.ts
│   └── view.test.ts
├── .gitignore
├── CHANGELOG.md
├── CONCEPT.md
├── LICENSE
├── README.md
├── package-lock.json
├── package.json
└── tsconfig.json
```

Implementation choices:

- TypeScript shipped directly through `./src/index.ts`.
- Node `>=22.19.0`.
- Strict TypeScript with `erasableSyntaxOnly` and no emitted build step.
- No runtime dependencies beyond host-provided Pi packages.
- Pi packages and `typebox` are peer dependencies with `"*"` ranges and development dependencies for local checks.
- `node:test` for focused reducer, replay, normalization, reminder, and view tests.
- The no-comment checker is adapted from `pi-phone` and runs against TypeScript and Python sources.
- Initial package version `0.1.0`, MIT license, English README and changelog.
- A one-line project entry is added to `~/INDEX.md` during implementation.

## CI and release

CI runs on pushes to `main` and pull requests:

```text
npm ci
npm run check
```

`npm run check` performs:

```text
tsc --noEmit
node tests
no-comment validation
npm pack --dry-run
```

Pushing a `v*` tag triggers the release workflow:

- verify that the tag matches `package.json`;
- run the full check suite;
- publish to npm with provenance and Trusted Publishing/OIDC;
- create a GitHub Release with generated notes.

The package includes the `pi-package` keyword so it can appear in the Pi package gallery.

## Acceptance criteria

1. `{"action":"start","id":1}` starts a task without a `status` field.
2. `{"action":"complete","id":1}` completes it without evidence.
3. No mutation requires the model to resend the full task list.
4. Historical malformed calls such as `update` with only `includeDeleted` and `tasks` produce an actionable error and never a false success.
5. Legacy `update` with a valid `status` normalizes to the matching lifecycle action.
6. Fifty completed tasks do not appear in the default `list`; only the latest three are returned.
7. A session with fifty completed tasks stores only the new operation on each later mutation, not another fifty-task snapshot.
8. Dependencies reject unresolved starts, unknown IDs, self-blocks, and cycles without partial mutation.
9. Repeated lifecycle calls are safe no-ops unless they supply new editable values.
10. Replay preserves IDs, timestamps, dependencies, pruning, clearing, and branch isolation.
11. Compaction injects one open-task reminder without the completed backlog.
12. Settle reconciliation runs at most once per genuine user prompt.
13. All checks pass with no source comments and the package tarball contains only intended files.
