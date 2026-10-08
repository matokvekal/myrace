# Services Folder Guide

Purpose

- Domain services for import mapping, template storage, and feature-specific orchestration.

Read Order

1. ../../../AGENT.md
2. ../AGENT.md
3. csvMapper.ts and related import helpers

Conventions

- Keep services deterministic and side-effect aware.
- Share mapping logic across all import entry points to avoid drift.

When To Update

- Import parsing behavior changes
- New storage or mapping strategies
