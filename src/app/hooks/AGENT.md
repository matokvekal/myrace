# Hooks Folder Guide

Purpose

- Reusable hooks for workflow state, side effects, and race UI behavior.

Read Order

1. ../../../AGENT.md
2. ../AGENT.md
3. Hook used by your target screen

Conventions

- Keep hooks pure where possible, with explicit dependencies.
- Document localStorage or persistence side effects in hook comments if non-obvious.

When To Update

- Hook API shape changes
- Side effect timing/dependency changes
