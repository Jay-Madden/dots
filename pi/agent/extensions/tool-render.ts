import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { generateDiffString, getLanguageFromPath, highlightCode, keyHint, renderDiff, type BashToolInput, type EditToolInput, type ExtensionAPI, type ExtensionContext, type Theme, type WriteToolInput } from "@earendil-works/pi-coding-agent";
import { mixColors, parseColor, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { applyEditsToNormalizedContent, normalizeToLF, stripBom } from "./vendor/edit-diff.ts";

export const HORIZONTAL_RULE = "\u2500";
export const STATUS_CIRCLE = "\u25cf";
export const PENDING_CIRCLE = "\u25cb";
const ERROR_SEPARATOR = "\u2014";
const ERROR_LIGHTENING = 0.5;
const ERROR_RED = parseColor("#ff7777");
const BASH_PREVIEW_LINES = 5;
const WRITE_PREVIEW_LINES = 10;
interface ToolCallResult {
  status: string;
  durationMs?: number;
  startedAt?: number;
  error?: string;
  output?: string;
  diff?: string;
}
interface EditPreviewState {
  diff?: string;
  error?: string;
}

export function renderExpandHint(theme: Theme): string {
  return theme.fg("muted", " (")
    + keyHint("app.tools.expand", "to expand")
    + theme.fg("muted", ")");
}

function renderToolOutput(output: string, path: string, theme: Theme, width: number): string[] {
  const language = getLanguageFromPath(path);
  let lines = output.split("\n");
  if (language !== undefined) {
    lines = highlightCode(output, language);
  } else {
    lines = lines.map((line) => theme.fg("toolOutput", line));
  }
  return new Text(lines.join("\n"), 0, 0)
    .render(Math.max(1, width - 5))
    .map((line) => `     ${line}`);
}

export function getToolCallGroups(message: AssistantMessage, toolName: string): ToolCall[][] {
  const groups: ToolCall[][] = [];
  let currentGroup: ToolCall[] | undefined;

  for (const block of message.content) {
    if (block.type !== "toolCall") {
      continue;
    }
    if (block.name !== toolName) {
      currentGroup = undefined;
      continue;
    }
    if (currentGroup === undefined) {
      currentGroup = [];
      groups.push(currentGroup);
    }
    currentGroup.push(block as ToolCall);
  }

  return groups;
}

function renderBashCall(
  bashCall: ToolCall,
  result: ToolCallResult | undefined,
  theme: Theme,
  width: number,
): string[] {
  const args = (bashCall.arguments ?? {}) as Partial<BashToolInput>;
  const lighterError = mixColors(theme.colors.error, ERROR_RED, ERROR_LIGHTENING);
  let status = "pending";
  if (result !== undefined) {
    status = result.status;
  }

  let indicator = theme.fg("text", PENDING_CIRCLE);
  let statusText = "";
  if (status === "complete") {
    indicator = theme.fg("success", STATUS_CIRCLE);
  } else if (status === "failed") {
    indicator = theme.style(STATUS_CIRCLE, { fg: lighterError });
    let errorMessage = result?.error;
    if (result?.output !== undefined) {
      errorMessage = "failed";
    } else if (errorMessage === undefined) {
      errorMessage = "bash failed";
    }
    statusText = ` ${theme.style(`${ERROR_SEPARATOR} ${errorMessage}`, { fg: lighterError })}`;
  } else if (status !== "running") {
    statusText = ` ${theme.fg("muted", status)}`;
  }

  let elapsedMs = result?.durationMs;
  if (elapsedMs === undefined && status === "running" && result?.startedAt !== undefined) {
    elapsedMs = Date.now() - result.startedAt;
  }
  let elapsedText = "";
  if (elapsedMs !== undefined) {
    elapsedText = ` ${theme.fg("muted", `(${(elapsedMs / 1000).toFixed(1)}s)`)}`;
  }
  let outputText = "";
  if (result?.output?.trim() === "(no output)") {
    outputText = ` ${theme.fg("muted", "(no output)")}`;
  }
  let timeoutText = "";
  if (args.timeout !== undefined) {
    timeoutText = ` ${theme.fg("muted", `(timeout ${args.timeout}s)`)}`;
  }

  const commandLines = (args.command ?? "").split(/\r?\n/);
  while (commandLines.length > 1 && commandLines[commandLines.length - 1] === "") {
    commandLines.pop();
  }
  const commandPrefix = ` ${indicator} ${theme.fg("toolTitle", "bash")}`;
  if (commandLines.length === 1) {
    const label = `${commandPrefix} ${theme.fg("accent", commandLines[0] ?? "")}${statusText}${outputText}${elapsedText}${timeoutText}`;
    return [truncateToWidth(label, width)];
  }

  const lines = [`${commandPrefix} ${theme.fg("accent", commandLines[0] ?? "")}`];
  for (let index = 1; index < commandLines.length; index++) {
    lines.push(`        ${theme.fg("accent", commandLines[index] ?? "")}`);
  }
  const metadata = `${statusText}${outputText}${elapsedText}${timeoutText}`;
  if (metadata.trim() !== "") {
    lines.push(`        ${metadata.trimStart()}`);
  }
  return lines.map((line) => truncateToWidth(line, width));
}

function renderEditCall(
  editCall: ToolCall,
  result: ToolCallResult | undefined,
  theme: Theme,
  cwd: string,
  width: number,
): string {
  const args = (editCall.arguments ?? {}) as Partial<EditToolInput>;
  const rawPath = args.path ?? "?";
  const resolvedPath = resolve(cwd, rawPath);
  const relativePath = relative(cwd, resolvedPath);
  let path = rawPath;
  if (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`)) {
    path = relativePath || ".";
  }

  const lighterError = mixColors(theme.colors.error, ERROR_RED, ERROR_LIGHTENING);
  let status = "pending";
  if (result !== undefined) {
    status = result.status;
  }
  let indicator = theme.fg("text", PENDING_CIRCLE);
  let statusText = "";
  if (status === "complete") {
    indicator = theme.fg("success", STATUS_CIRCLE);
  } else if (status === "failed") {
    indicator = theme.style(STATUS_CIRCLE, { fg: lighterError });
    let errorMessage = result?.error;
    if (errorMessage === undefined) {
      errorMessage = "edit failed";
    }
    statusText = ` ${theme.style(`${ERROR_SEPARATOR} ${errorMessage}`, { fg: lighterError })}`;
  } else if (status === "running") {
    statusText = ` ${theme.fg("warning", status)}`;
  } else {
    statusText = ` ${theme.fg("muted", status)}`;
  }
  const label = ` ${indicator} ${theme.fg("toolTitle", "edit")} ${theme.fg("accent", path)}${statusText}`;
  return truncateToWidth(label, width);
}

function renderEditDiff(diff: string, width: number): string[] {
  return new Text(renderDiff(diff), 0, 0)
    .render(Math.max(1, width - 5))
    .map((line) => `    ${line}`);
}

async function computePendingEditDiff(
  path: string,
  edits: EditToolInput["edits"],
  cwd: string,
): Promise<{ diff: string } | { error: string }> {
  let original: string;
  try {
    original = await readFile(resolve(cwd, path), "utf8");
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const { text } = stripBom(original);
  try {
    const { baseContent, newContent } = applyEditsToNormalizedContent(normalizeToLF(text), edits, path);
    return { diff: generateDiffString(baseContent, newContent).diff };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function renderWriteCall(
  writeCall: ToolCall,
  result: ToolCallResult | undefined,
  theme: Theme,
  cwd: string,
  width: number,
): string {
  const args = (writeCall.arguments ?? {}) as Partial<WriteToolInput>;
  const rawPath = args.path ?? "?";
  const resolvedPath = resolve(cwd, rawPath);
  const relativePath = relative(cwd, resolvedPath);
  let path = rawPath;
  if (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`)) {
    path = relativePath || ".";
  }

  const lighterError = mixColors(theme.colors.error, ERROR_RED, ERROR_LIGHTENING);
  let status = "pending";
  if (result !== undefined) {
    status = result.status;
  }
  let indicator = theme.fg("text", PENDING_CIRCLE);
  let statusText = "";
  if (status === "complete") {
    indicator = theme.fg("success", STATUS_CIRCLE);
  } else if (status === "failed") {
    indicator = theme.style(STATUS_CIRCLE, { fg: lighterError });
    let errorMessage = result?.error;
    if (errorMessage === undefined) {
      errorMessage = "write failed";
    }
    statusText = ` ${theme.style(`${ERROR_SEPARATOR} ${errorMessage}`, { fg: lighterError })}`;
  } else if (status === "running") {
    statusText = ` ${theme.fg("warning", status)}`;
  } else {
    statusText = ` ${theme.fg("muted", status)}`;
  }
  const label = ` ${indicator} ${theme.fg("toolTitle", "write")} ${theme.fg("accent", path)}${statusText}`;
  return truncateToWidth(label, width);
}

function renderReadCall(
  readCall: ToolCall,
  result: ToolCallResult | undefined,
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

  let indicator = theme.fg("text", PENDING_CIRCLE);
  let statusText = "";
  if (status === "complete") {
    indicator = theme.fg("success", STATUS_CIRCLE);
  } else if (status === "failed") {
    indicator = theme.style(STATUS_CIRCLE, { fg: lighterError });
    let errorMessage = result?.error;
    if (errorMessage === undefined) {
      errorMessage = "read failed";
    }
    statusText = ` ${theme.style(`${ERROR_SEPARATOR} ${errorMessage}`, { fg: lighterError })}`;
  } else if (status === "running") {
    statusText = ` ${theme.fg("warning", status)}`;
  } else {
    statusText = ` ${theme.fg("muted", status)}`;
  }
  const label = ` ${indicator} ${theme.fg("toolTitle", "read")} ${theme.fg("accent", path)}${theme.fg("dim", lineRange)}${statusText}`;
  return truncateToWidth(label, width);
}

class BashRow implements Component {
  result: ToolCallResult | undefined;
  expanded = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private onTick: (() => void) | undefined;
  private cachedWidth: number | undefined;
  private cachedExpanded: boolean | undefined;
  private cachedLines: string[] | undefined;
  private cachedOutput: string | undefined;
  private cachedOutputWidth: number | undefined;
  private cachedOutputColor: string | undefined;
  private cachedOutputLines: string[] | undefined;

  constructor(public call: ToolCall, public theme: Theme) {}

  startTimer(onTick: () => void) {
    this.onTick = onTick;
    if (this.timer === undefined) {
      this.timer = setInterval(() => this.onTick?.(), 1000);
    }
  }

  stopTimer() {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.onTick = undefined;
  }

  invalidate() {
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines !== undefined && this.cachedWidth === width && this.cachedExpanded === this.expanded) {
      return this.cachedLines;
    }

    const lines = renderBashCall(this.call, this.result, this.theme, width);
    if (this.result?.output) {
      // Preserve leading output indentation.
      const output = this.result.output.replace(/(?:\r?\n)+$/, "");
      if (output.trim() !== "" && output !== "(no output)") {
        const color = this.theme.getFgAnsi("toolOutput");
        if (this.cachedOutputLines === undefined || this.cachedOutput !== output
          || this.cachedOutputWidth !== width || this.cachedOutputColor !== color) {
          this.cachedOutputLines = renderToolOutput(output, "", this.theme, width);
          this.cachedOutput = output;
          this.cachedOutputWidth = width;
          this.cachedOutputColor = color;
        }
        const outputLines = this.cachedOutputLines;
        if (this.expanded) {
          lines.push(...outputLines);
        } else {
          const hiddenLines = outputLines.length - BASH_PREVIEW_LINES;
          if (hiddenLines > 0) {
            lines.push(
              this.theme.fg("muted", `     ... ${hiddenLines} earlier lines`) + renderExpandHint(this.theme),
            );
          }
          lines.push(...outputLines.slice(-BASH_PREVIEW_LINES));
        }
      }
    }
    this.cachedWidth = width;
    this.cachedExpanded = this.expanded;
    this.cachedLines = lines;
    return lines;
  }
}

class ReadRow implements Component {
  result: ToolCallResult | undefined;
  expanded = false;
  private cachedWidth: number | undefined;
  private cachedExpanded: boolean | undefined;
  private cachedLines: string[] | undefined;

  constructor(public call: ToolCall, public theme: Theme, public cwd: string) {}

  invalidate() {
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines !== undefined && this.cachedWidth === width && this.cachedExpanded === this.expanded) {
      return this.cachedLines;
    }

    const lines = [renderReadCall(this.call, this.result, this.theme, this.cwd, width)];
    if (this.expanded && this.result?.output) {
      const path = (this.call.arguments as { path?: string }).path ?? "";
      lines.push(...renderToolOutput(this.result.output, path, this.theme, width));
    }
    this.cachedWidth = width;
    this.cachedExpanded = this.expanded;
    this.cachedLines = lines;
    return lines;
  }
}

class WriteRow implements Component {
  result: ToolCallResult | undefined;
  expanded = false;
  private cachedWidth: number | undefined;
  private cachedExpanded: boolean | undefined;
  private cachedLines: string[] | undefined;

  constructor(public call: ToolCall, public theme: Theme, public cwd: string) {}

  invalidate() {
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines !== undefined && this.cachedWidth === width && this.cachedExpanded === this.expanded) {
      return this.cachedLines;
    }

    const lines = [renderWriteCall(this.call, this.result, this.theme, this.cwd, width)];
    const content = (this.call.arguments as Partial<WriteToolInput>).content;
    const path = (this.call.arguments as Partial<WriteToolInput>).path ?? "";
    if (content !== undefined && content !== "") {
      const contentLines = content.split(/\r?\n/);
      while (contentLines.length > 1 && contentLines[contentLines.length - 1] === "") {
        contentLines.pop();
      }

      const hiddenLines = contentLines.length - WRITE_PREVIEW_LINES;
      const visibleLines = this.expanded ? contentLines : contentLines.slice(0, WRITE_PREVIEW_LINES);
      lines.push(...renderToolOutput(visibleLines.join("\n"), path, this.theme, width));
      if (!this.expanded && hiddenLines > 0) {
        lines.push(
          this.theme.fg("muted", `     ... ${hiddenLines} more lines`) + renderExpandHint(this.theme),
        );
      }
    }
    this.cachedWidth = width;
    this.cachedExpanded = this.expanded;
    this.cachedLines = lines;
    return lines;
  }
}

class EditRow implements Component {
  result: ToolCallResult | undefined;
  preview: EditPreviewState | undefined;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(public call: ToolCall, public theme: Theme, public cwd: string) {}

  invalidate() {
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines !== undefined && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines = [renderEditCall(this.call, this.result, this.theme, this.cwd, width)];
    const diff = this.result?.diff ?? this.preview?.diff;
    if (this.result?.status !== "failed" && diff !== undefined && diff !== "") {
      lines.push(...renderEditDiff(diff, width));
    }
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}

export default function (pi: ExtensionAPI) {
  const readGroups: ReadRow[][] = [];
  const bashGroups: BashRow[][] = [];
  const writeGroups: WriteRow[][] = [];
  const editGroups: EditRow[][] = [];

  const getReadRow = (toolCallId: string): ReadRow | undefined =>
    readGroups.flat().find((row) => row.call.id === toolCallId);

  const updateReadGroups = (message: AssistantMessage, ctx: ExtensionContext) => {
    let group: ReadRow[] | undefined;
    for (const block of message.content) {
      if (block.type !== "toolCall") {
        continue;
      }
      if (block.name !== "read") {
        group = undefined;
        continue;
      }
      if (group === undefined) {
        group = readGroups.find((members) => members[0]?.call.id === block.id);
        if (group === undefined) {
          group = [];
          readGroups.push(group);
        }
      }
      if (!group.some((row) => row.call.id === block.id)) {
        group.push(new ReadRow(block, ctx.ui.theme, ctx.cwd));
      }
    }
  };

  const getWriteRow = (toolCallId: string): WriteRow | undefined =>
    writeGroups.flat().find((row) => row.call.id === toolCallId);

  const updateWriteGroups = (message: AssistantMessage, ctx: ExtensionContext) => {
    let group: WriteRow[] | undefined;
    for (const block of message.content) {
      if (block.type !== "toolCall") {
        continue;
      }
      if (block.name !== "write") {
        group = undefined;
        continue;
      }
      if (group === undefined) {
        group = writeGroups.find((members) => members[0]?.call.id === block.id);
        if (group === undefined) {
          group = [];
          writeGroups.push(group);
        }
      }
      if (!group.some((row) => row.call.id === block.id)) {
        group.push(new WriteRow(block, ctx.ui.theme, ctx.cwd));
      }
    }
  };

  const getEditRow = (toolCallId: string): EditRow | undefined =>
    editGroups.flat().find((row) => row.call.id === toolCallId);

  const updateEditGroups = (message: AssistantMessage, ctx: ExtensionContext) => {
    let group: EditRow[] | undefined;
    for (const block of message.content) {
      if (block.type !== "toolCall") {
        continue;
      }
      if (block.name !== "edit") {
        group = undefined;
        continue;
      }
      if (group === undefined) {
        group = editGroups.find((members) => members[0]?.call.id === block.id);
        if (group === undefined) {
          group = [];
          editGroups.push(group);
        }
      }
      if (!group.some((row) => row.call.id === block.id)) {
        group.push(new EditRow(block, ctx.ui.theme, ctx.cwd));
      }
    }
  };

  const getBashRow = (toolCallId: string): BashRow | undefined =>
    bashGroups.flat().find((row) => row.call.id === toolCallId);

  const updateBashGroups = (message: AssistantMessage, ctx: ExtensionContext) => {
    let group: BashRow[] | undefined;
    for (const block of message.content) {
      if (block.type !== "toolCall") {
        continue;
      }
      if (block.name !== "bash") {
        group = undefined;
        continue;
      }
      if (group === undefined) {
        group = bashGroups.find((members) => members[0]?.call.id === block.id);
        if (group === undefined) {
          group = [];
          bashGroups.push(group);
        }
      }
      if (!group.some((row) => row.call.id === block.id)) {
        group.push(new BashRow(block, ctx.ui.theme));
      }
    }
  };

  const clearBashTimers = () => {
    for (const group of bashGroups) {
      for (const row of group) {
        row.stopTimer();
      }
    }
  };

  const groupToolCalls = (message: AssistantMessage, ctx: ExtensionContext) => {
    updateReadGroups(message, ctx);
    updateWriteGroups(message, ctx);
    updateEditGroups(message, ctx);
    updateBashGroups(message, ctx);
  };

  const restoreToolCallGroups = (ctx: ExtensionContext) => {
    clearBashTimers();
    readGroups.length = 0;
    bashGroups.length = 0;
    writeGroups.length = 0;
    editGroups.length = 0;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        groupToolCalls(entry.message, ctx);
      }
    }
  };

  pi.on("session_start", (_event, ctx) => {
    restoreToolCallGroups(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreToolCallGroups(ctx);
  });

  pi.on("session_shutdown", clearBashTimers);

  pi.on("message_update", (event, ctx) => {
    if (event.message.role === "assistant") {
      updateReadGroups(event.message, ctx);
      updateWriteGroups(event.message, ctx);
      updateEditGroups(event.message, ctx);
      updateBashGroups(event.message, ctx);
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") {
      return;
    }

    groupToolCalls(event.message, ctx);
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

        const row = getReadRow(context.toolCallId);
        if (row === undefined) {
          throw new Error(`Missing read row for tool call ${context.toolCallId}`);
        }
        row.call = fallbackCall;
        row.theme = theme;
        row.cwd = context.cwd;
        row.invalidate();

        return {
          invalidate() {
            row.invalidate();
          },
          render(width: number) {
            const group = readGroups.find((members) => members.includes(row));
            if (group === undefined || group[0] !== row) {
              return [];
            }

            const lines: string[] = [];
            for (const member of group) {
              member.expanded = context.expanded;
              lines.push(...member.render(width));
            }

            if (!context.expanded) {
              lines.push(theme.fg("muted", "  ") + renderExpandHint(theme));
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

        const readResult: ToolCallResult = { status };
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
        const row = getReadRow(context.toolCallId);
        if (row === undefined) {
          throw new Error(`Missing read row for tool call ${context.toolCallId}`);
        }
        row.result = readResult;
        row.invalidate();
        return new Text("", 0, 0);
      },
    };
  });

  pi.registerToolRenderer((toolName, next) => {
    if (toolName !== "bash") {
      return next();
    }

    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        const fallbackCall = {
          type: "toolCall",
          id: context.toolCallId,
          name: "bash",
          arguments: args,
        } as ToolCall;

        const row = getBashRow(context.toolCallId);
        if (row === undefined) {
          throw new Error(`Missing bash row for tool call ${context.toolCallId}`);
        }
        row.call = fallbackCall;
        row.theme = theme;

        const bashState = context.state as { startedAt?: number };
        if (context.executionStarted && context.isPartial && bashState.startedAt === undefined) {
          bashState.startedAt = Date.now();
        }
        if (context.isPartial && bashState.startedAt !== undefined) {
          if (row.result !== undefined) {
            row.result.startedAt = bashState.startedAt;
          } else {
            row.result = { status: "running", startedAt: bashState.startedAt };
          }
          row.startTimer(context.invalidate);
        } else {
          row.stopTimer();
        }
        row.invalidate();

        return {
          invalidate() {
            row.invalidate();
          },
          render(width: number) {
            const group = bashGroups.find((members) => members.includes(row));
            if (group === undefined || group[0] !== row) {
              return [];
            }

            const lines: string[] = [];
            for (const member of group) {
              member.expanded = context.expanded;
              lines.push(...member.render(width));
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

        const row = getBashRow(context.toolCallId);
        if (row === undefined) {
          throw new Error(`Missing bash row for tool call ${context.toolCallId}`);
        }
        const previousResult = row.result;
        const bashState = context.state as { startedAt?: number };
        const startedAt = previousResult?.startedAt ?? bashState.startedAt;
        const bashResult: ToolCallResult = { status };
        if (status === "running") {
          if (startedAt !== undefined) {
            bashResult.startedAt = startedAt;
          }
        } else if (context.durationMs !== undefined) {
          bashResult.durationMs = context.durationMs;
        } else if (previousResult?.durationMs !== undefined) {
          bashResult.durationMs = previousResult.durationMs;
        } else if (startedAt !== undefined && (previousResult === undefined || previousResult.status === "running")) {
          bashResult.durationMs = Date.now() - startedAt;
        }
        if (output !== "") {
          bashResult.output = output;
        }
        if (context.isError) {
          const errorMessage = output
            .split(/\r?\n/)
            .find((line) => line.trim() !== "")
            ?.trim();
          if (errorMessage !== undefined) {
            bashResult.error = errorMessage;
          }
        }

        row.result = bashResult;
        row.invalidate();
        if (status === "running" && startedAt !== undefined) {
          row.startTimer(context.invalidate);
        } else {
          row.stopTimer();
        }
        return new Text("", 0, 0);
      },
    };
  });

  pi.registerToolRenderer((toolName, next) => {
    if (toolName !== "write") {
      return next();
    }

    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        const fallbackCall = {
          type: "toolCall",
          id: context.toolCallId,
          name: "write",
          arguments: args,
        } as ToolCall;

        const row = getWriteRow(context.toolCallId);
        if (row === undefined) {
          throw new Error(`Missing write row for tool call ${context.toolCallId}`);
        }
        row.call = fallbackCall;
        row.theme = theme;
        row.cwd = context.cwd;
        row.invalidate();

        return {
          invalidate() {
            row.invalidate();
          },
          render(width: number) {
            const group = writeGroups.find((members) => members.includes(row));
            if (group === undefined || group[0] !== row) {
              return [];
            }

            const lines: string[] = [];
            for (const member of group) {
              member.expanded = context.expanded;
              lines.push(...member.render(width));
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
        const writeResult: ToolCallResult = { status };
        if (context.isError) {
          const errorMessage = output
            .split(/\r?\n/)
            .find((line) => line.trim() !== "")
            ?.trim();
          if (errorMessage !== undefined) {
            writeResult.error = errorMessage;
          }
        }
        const row = getWriteRow(context.toolCallId);
        if (row === undefined) {
          throw new Error(`Missing write row for tool call ${context.toolCallId}`);
        }
        row.result = writeResult;
        row.invalidate();
        return new Text("", 0, 0);
      },
    };
  });

  pi.registerToolRenderer((toolName, next) => {
    if (toolName !== "edit") {
      return next();
    }

    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        const fallbackCall = {
          type: "toolCall",
          id: context.toolCallId,
          name: "edit",
          arguments: args,
        } as ToolCall;

        const row = getEditRow(context.toolCallId);
        if (row === undefined) {
          throw new Error(`Missing edit row for tool call ${context.toolCallId}`);
        }
        row.call = fallbackCall;
        row.theme = theme;
        row.cwd = context.cwd;
        row.invalidate();

        if (context.argsComplete && context.isPartial && row.preview === undefined) {
          const input = row.call.arguments as EditToolInput;
          row.preview = {};
          void computePendingEditDiff(input.path, input.edits, context.cwd).then((preview) => {
            if (getEditRow(context.toolCallId) !== row) {
              return;
            }
            row.preview = preview;
            row.invalidate();
            context.invalidate();
          });
        }

        return {
          invalidate() {
            row.invalidate();
          },
          render(width: number) {
            const group = editGroups.find((members) => members.includes(row));
            if (group === undefined || group[0] !== row) {
              return [];
            }

            const lines: string[] = [];
            for (const member of group) {
              lines.push(...member.render(width));
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
        const editResult: ToolCallResult = { status };
        if (context.isError) {
          const errorMessage = output
            .split(/\r?\n/)
            .find((line) => line.trim() !== "")
            ?.trim();
          if (errorMessage !== undefined) {
            editResult.error = errorMessage;
          }
        } else {
          const details = result.details as { diff?: string } | undefined;
          if (details?.diff !== undefined) {
            editResult.diff = details.diff;
          }
        }
        const row = getEditRow(context.toolCallId);
        if (row === undefined) {
          throw new Error(`Missing edit row for tool call ${context.toolCallId}`);
        }
        row.result = editResult;
        row.invalidate();
        return new Text("", 0, 0);
      },
    };
  });
}
