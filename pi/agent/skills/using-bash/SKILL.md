---
name: using-bash
description: REQUIRED TO LOAD BEFORE RUNNING BASH COMMANDS. Rules for constructing shell commands. TRIGGER before every use of the bash tool or whenever planning to run shell commands.
---

# Using Bash

## Required loading

- **!!! IMPORTANT:** Load this skill with the read tool before the first bash tool call in a task or session.
- **!!! IMPORTANT:** After loading this skill, call `bash_permission_state` before the first bash tool call to load the current autonomous-command allowlist into context.
- **!!! IMPORTANT:** Do not run a bash command until both this skill and the permission state have been loaded up front.
- Call `bash_permission_state` again after `/reload` or after bash permissions are changed.
- The loaded state is informational. The bash permission extension remains the enforcement boundary and may request approval.

## Command construction

- **IMPORTANT** Prefer native Bash constructs for shell logic instead of embedding Python or Ruby programs in shell commands.
- Use Bash conditionals, loops, functions, parameter expansion, pipelines, and standard command-line tools when they are sufficient.
- Prefer `jq` for reading, filtering, transforming, and validating JSON.
- Prefer `rg` for searching text and locating files by content.
- Use Python or Ruby only when Bash and the preferred command-line tools would make the solution substantially less clear, reliable, or maintainable.
