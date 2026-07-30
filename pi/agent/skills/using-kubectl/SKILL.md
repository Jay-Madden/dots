---
name: using-kubectl
description: Rules for running kubectl commands. TRIGGER when running any kubectl, helm, or Kubernetes CLI commands.
---

# Using kubectl

## Rules

**Before running any kubectl (or helm, k9s, etc.) command, you MUST:**

1. Print the full command to the user **without** the `--kubeconfig` flag so they can see what you're about to do.
2. Only then attempt automatically to run the actual command (which includes `--kubeconfig`).
3. Only use the `--kubeconfig` flag if using the current context is not specified. If the user says to use the current context, omit `--kubeconfig` entirely.

This lets the user review the meaningful parts of the command without the noisy kubeconfig path cluttering the output.
