---
name: using-bash
description: REQUIRED TO LOAD BEFORE RUNNING BASH COMMANDS. Rules for constructing shell commands. TRIGGER before every use of the bash tool or whenever planning to run shell commands.
---

# Using Bash

## Required loading

- Load this skill with the read tool before the first bash tool call in a task or session.
- Do not run a bash command until this skill has been loaded.

## Command construction

- **IMPORTANT** Prefer native Bash constructs for shell logic instead of embedding Python or Ruby programs in shell commands.
- Use Bash conditionals, loops, functions, parameter expansion, pipelines, and standard command-line tools when they are sufficient.
- Prefer `jq` for reading, filtering, transforming, and validating JSON.
- Prefer `rg` for searching text and locating files by content.
- Use Python or Ruby only when Bash and the preferred command-line tools would make the solution substantially less clear, reliable, or maintainable.
