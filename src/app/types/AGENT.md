# Types Folder Guide

Purpose

- Shared TypeScript contracts for domain models and CSV import fields.

Read Order

1. ../../../AGENT.md
2. ../AGENT.md
3. types.ts
4. csv.types.ts

Rules

- Treat these as cross-app contracts.
- Coordinate type changes with stores, import mappers, and UI rendering.
- Preserve backward compatibility for existing local IndexedDB data when possible.

When To Update

- Add/rename/remove model fields
- CSV mapping aliases/field definitions
- Validation assumptions used by import flows
