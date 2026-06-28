# Plan

GitHub Issues and project board 14 are the source of truth for roadmap, phase order, issue scope, acceptance criteria, dependencies, verification, and status.

This file intentionally does not duplicate the roadmap.

Use:

```sh
gh issue list --repo owainlewis/passage.md --state all --limit 100
gh project item-list 14 --owner owainlewis --limit 100
```

If this file, README, PRD, architecture docs, or strategy notes conflict with a GitHub issue, the GitHub issue wins.

Update local docs only for durable product principles, architecture facts, and local development instructions.
