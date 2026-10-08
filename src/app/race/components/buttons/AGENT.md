# Buttons Folder Guide

Purpose

- Small status-action buttons for a category/heat: Start / Running / Finished.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. ButtonStart.tsx, ButtonRunning.tsx, ButtonFinished.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - ButtonStart.tsx + buttonStart.module.css (triggers category/wave start)
  - ButtonRunning.tsx + buttonRunning.module.css (running-state indicator/button)
  - ButtonFinished.tsx + buttonFinished.module.css.css (note the doubled `.css.css`
    extension on this one file — historical, keep it importing correctly rather
    than silently "fixing" the filename without checking the import site)

When To Update

- Category/heat status button behavior or styling changes
- New status-transition button added
