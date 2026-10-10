import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";

const HORIZONTAL_RULE = "\u2500";

function getFirstReadCallId(message: AssistantMessage): string | undefined {
  const readCalls = message.content
    .filter((block) => block.type === "toolCall" && block.name === "read")
    .map((block) => block as ToolCall);

  return readCalls[0]?.id;
}

export default function (pi: ExtensionAPI) {
  const firstReadCallIds = new Set<string>();

  const restoreFirstReadCallIds = (ctx: ExtensionContext) => {
    firstReadCallIds.clear();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message" || entry.message.role !== "assistant") {
        continue;
      }

      const firstReadCallId = getFirstReadCallId(entry.message);
      if (firstReadCallId !== undefined) {
        firstReadCallIds.add(firstReadCallId);
      }
    }
  };

  pi.on("session_start", (_event, ctx) => {
    restoreFirstReadCallIds(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreFirstReadCallIds(ctx);
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") {
      return;
    }

    const firstReadCallId = getFirstReadCallId(event.message);
    if (firstReadCallId !== undefined) {
      firstReadCallIds.add(firstReadCallId);
    }
  });

  pi.registerToolRenderer((toolName, next) => {
    if (toolName !== "read") {
      return next();
    }

    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        const readArgs = args as { path?: string; offset?: number | null; limit?: number | null };
        const rawPath = readArgs.path ?? "?";
        const resolvedPath = resolve(context.cwd, rawPath);
        const relativePath = relative(context.cwd, resolvedPath);
        let path = rawPath;
        if (!isAbsolute(relativePath)
          && relativePath !== ".."
          && !relativePath.startsWith(`..${sep}`)) {
          path = relativePath || ".";
        }

        const startLine = readArgs.offset ?? 1;
        let endLine: number | undefined;
        if (readArgs.limit != null) {
          endLine = startLine + readArgs.limit - 1;
        }

        let lineRange = "";
        if (readArgs.offset != null || readArgs.limit != null) {
          lineRange = `:${startLine}`;
          if (endLine !== undefined) {
            lineRange += `-${endLine}`;
          }
        }
        const state = context.state as { status?: string };
        return {
          invalidate() {},
          render(width: number) {
            const status = state.status ?? "pending";
            let color: "muted" | "success" | "error" | "warning" = "muted";

            if (status === "complete") {
              color = "success";
            } else if (status === "failed") {
              color = "error";
            } else if (status === "running") {
              color = "warning";
            }
            const label = `${theme.fg("toolTitle", "read")} ${theme.fg("accent", `${path}${lineRange}`)} ${theme.fg(color, status)}`;
            const line = truncateToWidth(label, width);

            if (firstReadCallIds.has(context.toolCallId)) {
              return [theme.fg("dim", HORIZONTAL_RULE.repeat(width)), line];
            }

            return [line];
          },
        };
      },
      renderResult(_result, options, _theme, context) {
        const state = context.state as { status?: string };
        if (options.isPartial) {
          state.status = "running";
        } else if (context.isError) {
          state.status = "failed";
        } else {
          state.status = "complete";
        }
        return new Text("", 0, 0);
      },
    };
  });
}
