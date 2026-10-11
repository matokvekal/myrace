# Auth Folder Guide

Purpose

- Authentication UI blocks: token-based login (`TokenLogin`) and a permission
  gate wrapper (`PermissionGate`) for role-restricted UI.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. TokenLogin.tsx, PermissionGate.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - TokenLogin.tsx + tokenLogin.module.css (token-based login form)
  - PermissionGate.tsx (wraps children, renders only if the current
    user/role has the required permission)

Conventions

- Login is optional for core race operations — most race workflows must keep
  working without a logged-in user; don't make `PermissionGate` block
  offline-first flows that were previously unauthenticated.

When To Update

- Token login flow changes
- Permission-gating rules or role model change
