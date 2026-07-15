import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const commandPrefixes = [
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "rg",
  "fd",
  "find",
  "tree",
  "wc",
  "stat",
  "file",
  "pwd",
  "which",
  "echo",
  "diff",
  "git status",
  "git diff",
  "git log",
  "git show",
  "git branch",
  "glean-cli",
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") {
      return undefined;
    }

    const command = (event.input as { command?: unknown }).command;
    if (typeof command !== "string" || isAllowed(command)) {
      return undefined;
    }
    return requestApproval(ctx, "Approve bash command?", command);
  });
}

function isAllowed(command: string): boolean {
  return commandPrefixes.some(
    (prefix) => command === prefix || command.startsWith(`${prefix} `),
  );
}

async function requestApproval(
  ctx: ExtensionContext,
  title: string,
  message: string,
) {
  if (!ctx.hasUI) {
    return {
      block: true,
      reason: `${title} Approval is unavailable without an interactive UI: ${message}`,
    };
  }

  const approved = await ctx.ui.confirm(title, message);
  return approved
    ? undefined
    : { block: true, reason: "Operation was denied by the user" };
}
