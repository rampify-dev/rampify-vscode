# Rampify workflow rules

This file makes Claude follow Rampify's spec-driven development workflow. Reference it from your `CLAUDE.md` so Claude reads it on every session:

```
See [.claude/rules/rampify.md](.claude/rules/rampify.md) for Rampify workflow.
```

Installed by `rampify init`. Strict-default — customers who want a softer flow can edit this file directly.

## Before implementing

Every change traces back to a Rampify feature spec. Before writing code:

1. **Discuss** the problem, investigate the codebase, understand scope.
2. **Create the spec** via `mcp__rampify__create_feature_spec`. Small specs are fine — a one-task spec for a one-commit fix is the right shape. The friction of creating a tiny spec is much lower than the friction of an unattributed commit later.
3. **Wait for explicit user approval** before writing any code. The spec IS the plan.

Anti-patterns:

- **Catch-all "misc" specs** that accumulate unrelated work. They turn into write-only logs.
- **Commits before the spec exists** ("I'll just commit this and spec it after"). The spec doesn't get created later — the commit ends up unattributed.
- **"I'll spec later" intent.** Later doesn't happen. The right time to create the spec is before the first edit.

## As you work

- Mark a task `in_progress` before its first edit (via `update_spec_task`).
- Mark it `completed` after the commit lands locally.
- On the spec's first task started, move the spec from `planned → in_progress` (via `update_feature_spec`).

## After every commit that advances a spec

Call `mcp__rampify__link_commit` AND include trailers in the commit message:

```
<commit subject>

<commit body>

Co-Authored-By: ...
Spec: <dashboard_url>
Task: <task_uuid>
```

Rules:

- The `Spec:` URL is the `dashboard_url` field returned by the MCP response (`create_feature_spec` / `get_feature_spec` / `list_feature_specs` / `update_feature_spec` all return it). **Never hand-construct** — the URL contains a workspace id, not the spec's project id.
- Always pass `task_id` to `link_commit` when one task drove the commit. Spec-only linking is the exception (architecture work, multi-task refactors), not the default.
- Multiple specs in one commit → multiple `Spec:` lines. Same for `Task:` (rare; usually a sign the commit should be split).
- The `rampify-link-commit-reminder.sh` PostToolUse hook will remind you about this after every `git commit`.

Pass `commit_message` to `link_commit` so the trailers are parsed automatically — saves you a second lookup.

## Referencing a spec in conversation

When you mention a spec to the user, render it as a clickable markdown link — `[<title> (<status>)](<dashboard_url>)` — never a bare id or short id (e.g. `62a09eb9`), which the user can't click or look up. Use the `dashboard_url` the MCP returns (same field as the `Spec:` trailer; never hand-construct it). If a short id is all you have (from memory or a commit trailer), pass it to `get_feature_spec` — it resolves a short prefix to the full spec — then link the title + `dashboard_url` it returns.

## After all tasks land

- Spec → `completed`. The work is done; code may be on staging or merged but not yet deployed. This is **not** a "live in prod" claim.

## After deploy to production

- Spec → `verified`. The canonical "live in production" signal. Don't bump to `verified` until the change is actually visible to users on prod and you've eyeballed it.

## Lifecycle quick reference

| status | meaning |
|--------|---------|
| `idea` | captured, not committed to do (hidden from default views) |
| `planned` | will do, hasn't started |
| `in_progress` | work in flight, may be on a branch or staging |
| `completed` | tasks done; may be on staging or merged but not yet deployed |
| `verified` | live on production AND human-confirmed working |
| `deprecated` | abandoned, will not ship |

For specs that don't ship to production (exploration, internal-only infra, abandoned work): stay at `completed` permanently, or move to `deprecated` if explicitly killed. Don't fake a `verified` bump just to clear the dashboard.

For docs-only changes, internal tooling, infra refactors invisible to users: treat `completed` as the terminal state. `verified` is reserved for things that have a "live on prod for users to see" meaning.

## Spec context on session start

The `rampify-session-start.sh` SessionStart hook primes you on every session:

- If `.context/spec.md` exists, read it first and continue from where work left off.
- If it doesn't exist, call `list_feature_specs` and ask the user to pick one, then write the chosen spec to `.context/spec.md`.

This makes spec context persist across `/resume` and across multiple Claude sessions in the same workspace.
