---
name: using-git
description: Required workflow for Git status, diffs, commits, rebases, and pushes. Use before running Git commands or planning repository changes.
---

# Using Git

## Before changing history or publishing

Before staging, committing, rebasing, merging, or pushing, inspect:

```bash
git status --short
git diff --check
git diff
git log --oneline -12
```

- Identify every pre-existing modified, staged, and untracked file.
- Do not stage, modify, discard, stash, commit, or otherwise alter unrelated user changes.
- Review recent commit subjects and use the repository's established convention.

## Commits

- Prefer Conventional Commit messages unless the repository history suggests a different pattern.
- Stage files by explicit path. Never use `git add .`, `git add -A`, or `git commit -a`.
- Confirm the staged diff contains only the requested change before committing.
- Use a concise commit message matching repository commit conventions.
- Do not amend, reset, reword, squash, or force-push unless the user explicitly requests it.
- Run the relevant available validation before committing. At minimum, run `git diff --check`.

## Pushes and remote updates

- Push only when the user explicitly requests it or a task explicitly requires it.
- If a push is rejected, inspect status and fetch remote state before choosing a resolution.
- Preserve unrelated worktree changes. Do not use stash, autostash, pull, rebase, merge, reset, or force-push to resolve a rejected push without telling the user the exact recovery plan first.
- After a successful push, report the commit hash and confirm any unrelated changes still remain uncommitted.
