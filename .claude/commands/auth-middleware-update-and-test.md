---
name: auth-middleware-update-and-test
description: Workflow command scaffold for auth-middleware-update-and-test in agent.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /auth-middleware-update-and-test

Use this workflow when working on **auth-middleware-update-and-test** in `agent`.

## Goal

Update authentication middleware logic and add or update corresponding tests to ensure correct behavior.

## Common Files

- `src/auth/middleware.ts`
- `src/auth/middleware.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Modify authentication logic in src/auth/middleware.ts
- Update or add tests in src/auth/middleware.test.ts

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.