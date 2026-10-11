# Admin Folder Guide

Purpose

- Admin panel for generating user tokens and managing roles (view roles,
  generate a token scoped to a role + race, copy it to share with a commissaire).

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. AdminPanel.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - AdminPanel.tsx
  - adminPanel.module.css

Conventions

- Depends on `hooks/useAuth`, `stores/rbacStore`, and `types/rbac.types` — part
  of the Phase 2 roles system (Owner/Commissaire/Viewer) described in
  `docs/roadmap.md`. Verify those dependencies actually exist/are wired before
  assuming this panel is fully functional end to end.

When To Update

- Role/token-generation flow changes
- New role type added to the RBAC model
