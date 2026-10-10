import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";

const HORIZONTAL_RULE = "\u2500";

function getReadCallGroups(message: AssistantMessage): ToolCall[][] {
  const groups = message.content.reduce<ToolCall[][]>((groups, block) => {
    const lastGroup = groups[groups.length - 1];
    if (block.type !== "toolCall") {
      return groups;
    }
    if (block.name !== "read") {
      if (lastGroup && lastGroup.length > 0) {
        groups.push([]);
      }
      return groups;
    }
    if (lastGroup && lastGroup.length > 0) {
      lastGroup.push(block as ToolCall);
    } else {
      groups.push([block as ToolCall]);
    }
    return groups;
  }, []);

  return groups.filter((group) => group.length > 0);
}

function renderReadCall(
  readCall: ToolCall,
  callStatus: string | undefined,
  theme: Theme,
  cwd: string,
  width: number,
): string {
  const args = readCall.arguments as { path?: string; offset?: number | null; limit?: number | null };
  const rawPath = args.path ?? "?";
  const resolvedPath = resolve(cwd, rawPath);
  const relativePath = relative(cwd, resolvedPath);

  let path = rawPath;
  if (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`)) {
    path = relativePath || ".";
  }

  const startLine = args.offset ?? 1;
  let lineRange = "";
  if (args.offset != null || args.limit != null) {
    lineRange = `:${startLine}`;
    if (args.limit != null) {
      lineRange += `-${startLine + args.limit - 1}`;
    }
  }

  let status = callStatus;
  if (status === undefined) {
    status = "pending";
  }
  let color: "muted" | "success" | "error" | "warning" = "muted";
  if (status === "complete") {
    color = "success";
  } else if (status === "failed") {
    color = "error";
  } else if (status === "running") {
    color = "warning";
  }
  const label = `${theme.fg("toolTitle", "read")} ${theme.fg("accent", `${path}${lineRange}`)} ${theme.fg(color, status)}`;
  return truncateToWidth(label, width);
}

export default function (pi: ExtensionAPI) {
  const readGroups: ToolCall[][] = [];
  const readStatuses = new Map<string, string>();

  const rememberReadGroups = (message: AssistantMessage) => {
    readGroups.push(...getReadCallGroups(message));
  };

  const restoreReadGroups = (ctx: ExtensionContext) => {
    readGroups.length = 0;
    readStatuses.clear();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        rememberReadGroups(entry.message);
      }
    }
  };

  pi.on("session_start", (_event, ctx) => {
    restoreReadGroups(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreReadGroups(ctx);
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") {
      return;
    }

    rememberReadGroups(event.message);
  });

  pi.registerToolRenderer((toolName, next) => {
    if (toolName !== "read") {
      return next();
    }

    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        const readArgs = args as { path?: string; offset?: number | null; limit?: number | null };
        const fallbackCall = {
          type: "toolCall",
          id: context.toolCallId,
          name: "read",
          arguments: readArgs,
        } as ToolCall;
        return {
          invalidate() {},
          render(width: number) {
            const group = readGroups.find((calls) => calls.some((call) => call.id === context.toolCallId));
            if (group !== undefined && group[0]?.id !== context.toolCallId) {
              return [];
            }

            const calls = group ?? [fallbackCall];
            const lines = calls.map((call) => {
              let status = readStatuses.get(call.id);
              if (status === undefined && call.id === context.toolCallId) {
                status = (context.state as { status?: string }).status;
              }
              return renderReadCall(call, status, theme, context.cwd, width);
            });

            return [theme.fg("dim", HORIZONTAL_RULE.repeat(width)), ...lines];
          },
        };
      },
      renderResult(_result, options, _theme, context) {
        let status: string;
        if (options.isPartial) {
          status = "running";
        } else if (context.isError) {
          status = "failed";
        } else {
          status = "complete";
        }
        readStatuses.set(context.toolCallId, status);
        return new Text("", 0, 0);
      },
    };
  });
}
