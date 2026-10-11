# Docs Folder Guide

Purpose

- Product and implementation documentation for major features and operations.

Read Order

1. ../AGENT.md
2. ../BUGS.md (known bugs — app-review.md was retired, its content lives there now)
3. roadmap.md (planned phases)
4. app-rules.md (formal RULE-XXX-NN business-rule catalog, traced to file:line)
5. Feature doc matching your task (csv-import.md, local-ocr.md, race-data.md, etc.)

What Lives Here

- Requirements, architecture notes, known issues, migration notes.
- Cloud sync docs under cloud/.

When To Update

- Any behavior change that affects product flow.
- Any bug fix that closes or modifies a known issue.
- Any workflow that an agent repeatedly rediscovers from code.

Do Not

- Put source-of-truth runtime logic here; code in src/ remains authoritative.
