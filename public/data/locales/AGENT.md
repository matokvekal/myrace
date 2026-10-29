# Locales Folder Guide

Purpose

- UI translation strings: `en.json`, `he.json`, and an `index.json` manifest
  listing available locales.

Read Order

1. ../../../AGENT.md
2. ../AGENT.md

No child folders.

Conventions

- Hebrew + English support is a hard requirement app-wide (root CLAUDE.md
  "Important Constraints") — any new UI string must be added to both `en.json`
  and `he.json` together, and `index.json` updated if a new locale is added.
