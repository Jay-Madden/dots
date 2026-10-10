import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { getLanguageFromPath, highlightCode, keyHint, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { mixColors, parseColor, Text, truncateToWidth } from "@earendil-works/pi-tui";

const HORIZONTAL_RULE = "\u2500";
const STATUS_CIRCLE = "\u25cf";
const PENDING_CIRCLE = "\u25cb";
const ERROR_SEPARATOR = "\u2014";
const ERROR_LIGHTENING = 0.5;
const ERROR_RED = parseColor("#ff7777");
interface ReadResult {
  status: string;
  error?: string;
  output?: string;
}

export function renderExpandHint(theme: Theme): string {
  return theme.fg("muted", "   (")
    + keyHint("app.tools.expand", "to expand")
    + theme.fg("muted", ")");
}

function renderReadOutput(output: string, path: string, theme: Theme, width: number): string[] {
  const language = getLanguageFromPath(path);
  let lines = output.split("\n");
  if (language !== undefined) {
    lines = highlightCode(output, language);
  } else {
    lines = lines.map((line) => theme.fg("toolOutput", line));
  }
  return new Text(lines.join("\n"), 0, 0)
    .render(Math.max(1, width - 3))
    .map((line) => `   ${line}`);
}

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
  result: ReadResult | undefined,
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
    lineRange = ` lines ${startLine}..`;
    if (args.limit != null) {
      lineRange = ` lines ${startLine}..${startLine + args.limit - 1}`;
    }
  }

  const lighterError = mixColors(theme.colors.error, ERROR_RED, ERROR_LIGHTENING);
  let status = "pending";
  if (result !== undefined) {
    status = result.status;
  }
  let color: "muted" | "success" | "error" | "warning" = "muted";
  if (status === "complete") {
    color = "success";
  } else if (status === "failed") {
    color = "error";
  } else if (status === "running") {
    color = "warning";
  }

  let indicator = theme.fg("text", PENDING_CIRCLE);
  if (status === "complete") {
    indicator = theme.fg("success", STATUS_CIRCLE);
  } else if (status === "failed") {
    indicator = theme.style(STATUS_CIRCLE, { fg: lighterError });
  }
  let statusText = ` ${theme.fg(color, status)}`;
  if (status === "complete") {
    statusText = "";
  } else if (status === "failed") {
    let errorMessage = result?.error;
    if (errorMessage === undefined) {
      errorMessage = "read failed";
    }
    statusText = ` ${theme.style(`${ERROR_SEPARATOR} ${errorMessage}`, { fg: lighterError })}`;
  }
  const label = ` ${indicator} ${theme.fg("toolTitle", "read")} ${theme.fg("accent", path)}${theme.fg("dim", lineRange)}${statusText}`;
  return truncateToWidth(label, width);
}

export default function (pi: ExtensionAPI) {
  const readGroups: ToolCall[][] = [];
  const readResults = new Map<string, ReadResult>();

  const rememberReadGroups = (message: AssistantMessage) => {
    readGroups.push(...getReadCallGroups(message));
  };

  const restoreReadGroups = (ctx: ExtensionContext) => {
    readGroups.length = 0;
    readResults.clear();
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
            const lines: string[] = [];
            for (const call of calls) {
              const result = readResults.get(call.id);
              lines.push(renderReadCall(call, result, theme, context.cwd, width));
              if (context.expanded && result?.output) {
                const path = (call.arguments as { path?: string }).path ?? "";
                lines.push(...renderReadOutput(result.output, path, theme, width));
              }
            }

            if (!context.expanded) {
              lines.push(renderExpandHint(theme));
            }
            return [theme.fg("dim", HORIZONTAL_RULE.repeat(width)), ...lines];
          },
        };
      },
      renderResult(result, options, _theme, context) {
        let status: string;
        if (options.isPartial) {
          status = "running";
        } else if (context.isError) {
          status = "failed";
        } else {
          status = "complete";
        }
        const output = result.content
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n");

        const readResult: ReadResult = { status };
        if (!context.isError && output !== "") {
          readResult.output = output;
        }
        if (context.isError) {
          const errorMessage = output
            .split(/\r?\n/)
            .find((line) => line.trim() !== "")
            ?.trim();
          if (errorMessage !== undefined) {
            readResult.error = errorMessage;
          }
        }
        readResults.set(context.toolCallId, readResult);
        return new Text("", 0, 0);
      },
    };
  });
}
