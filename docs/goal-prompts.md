# Goal Prompts

Use these prompts when Codex should keep working until the job is really done.

A goal is useful when Codex needs to try something, check it, fix what broke, and check again.

A normal prompt is better when one pass is enough.

Every goal should have proof.

Proof can be a passing command, a PR link, a screenshot, a browser check, or a clear blocker.

Do not rely on "looks done".

## Single Task

What is this goal for?

Use this when one task should become one draft PR.

What problem does it solve?

It stops the agent from making a change and quitting before tests, review, and acceptance checks are done.

How does it work?

Codex reads the task, works in its own branch and worktree, makes the smallest complete change, runs checks, uses review and acceptance subagents, then opens a draft PR.

```md
/goal
Use the `task-to-pr` skill to implement the provided task.

Do not stop until one of these is true:

1. A draft PR has been opened for the task.
2. The work is genuinely blocked and the blocker is reported with evidence.

Before changing code, read the task, `AGENTS.md`, `README.md`, and any referenced files or docs.

Keep the work scoped to the task.

Use a dedicated branch and worktree.

Follow the existing codebase patterns.

Make the smallest complete change that satisfies the task.

Add or update tests for changed behavior.

The PR must not be opened until the work has been tested and verified.

Required verification:

- Run the relevant automated tests.
- Run the repo's documented lint and quality checks.
- Run the app locally if the task changes user-facing behavior.
- For UI changes, verify desktop and mobile in a real browser.
- Use a review subagent to check for bugs, broken old behavior, missing tests, and extra work that was not asked for.
- Use a separate acceptance subagent to check the task's acceptance criteria.
- Review the final diff for unrelated changes, brittle code, missing tests, and broken docs.

Fix valid failures and repeat until verification is clean.

Then commit, push, open a draft PR, and update the task with the PR link and verification evidence.

The PR body must include the task link or task text, summary of changes, acceptance criteria status, and verification commands with results.

The final report must include the PR URL, branch, commit hash, files changed, checks run, and any known risks.

Stop and ask if the task is unclear, already has an open PR, needs missing secrets or product decisions, repeats the same blocker three times, or requires expanding beyond task scope.

Do not merge, deploy, combine unrelated work, discard unrelated local changes, or edit changelogs, generated files, vendored files, or lockfiles unless required.
```

## Task List

What is this goal for?

Use this when you pass Codex a short list of tasks and want one draft PR per task.

What problem does it solve?

It stops several tasks from being mixed into one messy branch or one oversized PR.

How does it work?

Codex works through the list one task at a time.

Each task gets its own branch, worktree, verification, and draft PR.

The goal keeps the number of open PRs small so review does not pile up.

```md
/goal
Use the `task-to-pr` workflow to implement the provided task list.

Create one draft PR per task.

Do not stop until every task has either a verified draft PR or a blocker reported with evidence.

Before changing code, read the task list, `AGENTS.md`, `README.md`, and any referenced files or docs.

Work one task at a time unless the user explicitly asks for parallel work.

For each task, use a dedicated branch and worktree.

Keep each PR scoped to exactly one task.

Follow the existing codebase patterns.

Make the smallest complete change that satisfies the current task.

Add or update tests for changed behavior.

Do not open a PR until that task has been tested and verified.

Required verification for each task:

- Run the relevant automated tests.
- Run the repo's documented lint and quality checks.
- Run the app locally if the task changes user-facing behavior.
- For UI changes, verify desktop and mobile in a real browser.
- Use a review subagent to check for bugs, broken old behavior, missing tests, and extra work that was not asked for.
- Use a separate acceptance subagent to check the task's acceptance criteria.
- Review the final diff for unrelated changes, brittle code, missing tests, and broken docs.

Fix valid failures and repeat until verification is clean for that task.

Then commit, push, open a draft PR, and update the task with the PR link and verification evidence.

Each PR body must include the task link or task text, summary of changes, acceptance criteria status, and verification commands with results.

The final report must include every PR URL, branch, commit hash, files changed, checks run, and any known risks.

Keep at most 2 draft PRs open from this goal unless the user approves more.

Stop and ask if a task is unclear, depends on an unreviewed earlier PR, already has an open PR, needs missing secrets or product decisions, repeats the same blocker three times, or requires expanding beyond its scope.

Do not merge, deploy, combine tasks in one PR, discard unrelated local changes, or edit changelogs, generated files, vendored files, or lockfiles unless required.
```

## Why These Prompts Work

They make the finish line clear.

The agent is done only when a draft PR exists or the blocker is reported with evidence.

They force isolation.

A dedicated branch and worktree keep agent edits away from the user's current checkout.

They keep scope small.

The prompt says to make the smallest complete change and to avoid unrelated work.

They make verification a gate.

The agent cannot open the PR until tests, quality checks, and required manual checks are done.

They add two kinds of review.

The review subagent looks for implementation risk.

The acceptance subagent checks the task requirements.

They require evidence.

The PR body and task update must include what changed, what passed, and what was checked.

They define when to stop.

The agent must stop for unclear tasks, missing decisions, repeated blockers, and scope expansion.

## Other Useful Goals

Use goals when the valuable part is repeated repair and re-checking.

Use a normal prompt when one pass is enough.

### Restore Local Quality

What is this goal for?

Use this when the local project is broken and you want the normal checks green again.

What problem does it solve?

It stops Codex from fixing only the first error and leaving the next error for you.

How does it work?

Codex runs the failing check, fixes the smallest clear problem, then runs the check again.

It keeps going until lint, tests, and build pass, or until it hits a real blocker.

```md
/goal
Make the current passage.md working tree pass the documented local quality checks.

Do not stop until `npm run lint`, `npm test`, and `npm run build:web` pass, or the work is genuinely blocked and the blocker is reported with evidence.

Before changing code, read `AGENTS.md`, `README.md`, and the files touched in the current diff.

Keep fixes scoped to current local changes.

Do not add unrelated features or refactors.

Run the failing check first after each fix.

When all checks pass, report the commands, results, files changed, and any remaining risks.

Stop and ask if the same failure repeats three times, a fix requires changing product scope, or the failing code belongs to unrelated human work.

Do not discard unrelated local changes, edit generated files, or modify lockfiles unless required.
```

### Visual QA Repair

What is this goal for?

Use this when the app looks wrong or might be broken on desktop or mobile.

What problem does it solve?

Code can pass tests while the page still has overflow, overlap, clipped text, or console errors.

How does it work?

Codex runs the app, checks it in a real browser, fixes visible defects, and checks again.

It also runs the normal project checks before saying the work is done.

```md
/goal
Make the current app shell visually pass desktop and mobile browser verification.

Do not stop until the app is running locally, desktop and mobile screenshots are checked, and no layout, overflow, overlap, clipped text, or console-error defects remain.

Before changing code, read `AGENTS.md`, `README.md`, and the relevant app files.

Keep the visual style consistent with passage.md's calm writing surface.

Run the app locally after changes.

Verify desktop and mobile in a real browser.

Run `npm run lint`, `npm test`, and `npm run build:web` before reporting success.

Report the local URL, viewport sizes checked, screenshots or screenshot paths, commands run, and files changed.

Stop and ask if the visual requirement is subjective, conflicts with the product docs, or requires new product scope.
```

### Docs Consistency Repair

What is this goal for?

Use this when the project docs might disagree with each other.

What problem does it solve?

Agents make worse changes when local docs are treated as a second roadmap.

How does it work?

Codex reads the core docs, fixes one real mismatch at a time, and re-checks for the same mismatch.

It stops before making product decisions.

GitHub Issues and project board 14 remain the source of truth.

```md
/goal
Make passage.md's local docs defer to GitHub Issues and project board 14.

Do not stop until `AGENTS.md`, `README.md`, `plan.md`, `docs/prd.md`, and `docs/architecture.md` clearly say GitHub Issues and project board 14 are the source of truth for roadmap, scope, acceptance criteria, dependencies, verification, and status.

Before changing docs, read those files plus any GitHub issue referenced by the mismatch.

Patch one real contradiction at a time.

Preserve durable product and architecture direction.

Do not duplicate issue bodies, phase plans, or acceptance criteria into local docs.

After each fix, re-scan for the same mismatch.

Report files changed, contradictions fixed, scans run, and any decision that still needs Owain.

Stop and ask if resolving a mismatch would change product direction, require a roadmap decision, or touch implementation files.
```

### Issue Readiness Repair

What is this goal for?

Use this when an issue is too vague for an agent to implement safely.

What problem does it solve?

Bad issues lead to guessing, extra work that was not asked for, weak tests, and noisy PRs.

How does it work?

Codex turns the issue into a clear task with a goal, context, acceptance criteria, verification steps, and out-of-scope notes.

It stops if the issue needs a product decision.

```md
/goal
Make the selected passage.md issue agent-ready.

Do not stop until the issue has a clear goal, context, acceptance criteria, verification steps, and explicit out-of-scope notes, or the missing decision is reported with evidence.

Before editing, read `AGENTS.md`, the selected issue, and any referenced docs.

Keep the issue scoped to one focused implementation run.

Prefer concrete verification commands over vague success criteria.

Update only the selected issue.

Report the final issue text, files or tracker fields changed, and any assumptions.

Stop and ask if the issue requires a product decision, combines unrelated work, or depends on another unresolved issue.
```
