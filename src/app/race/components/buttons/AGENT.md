# Buttons Folder Guide

Purpose

- Small status-action buttons for a category/heat: Start / Running / Finished.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md

Immediate Children Summary

- No child folders.
- Top-level files:
  - ButtonRunning.tsx + buttonRunning.module.css (running-state indicator/button)
    extension on this one file — historical, keep it importing correctly rather
    than silently "fixing" the filename without checking the import site)

When To Update

- Category/heat status button behavior or styling changes
- New status-transition button added
