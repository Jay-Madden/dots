import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEditToolDefinition,
  getLanguageFromPath,
  getMarkdownTheme,
  isToolCallEventType,
  type EditToolInput,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { Box, Key, Markdown, Text } from "@earendil-works/pi-tui";
import {
  applyEditsToNormalizedContent,
  normalizeToLF,
  stripBom,
} from "./vendor/edit-diff.ts";
import { approval, type Approval } from "./components/approval.ts";

type Review = {
  directory: string;
  previousFile: string;
  proposedFile: string;
  commentsFile: string;
};

const diffLua = fileURLToPath(new URL("./assets/diff.lua", import.meta.url));

function diffCommand(review: Review): string {
  return `lua local diff = dofile("${diffLua}"); diff.setup(); diff.diff("${review.previousFile}", "${review.commentsFile}")`;
}

function resolveToolPath(path: string, cwd: string): string {
  const withoutAtPrefix = path.startsWith("@") ? path.slice(1) : path;
  const expandedPath = withoutAtPrefix === "~"
    ? homedir()
    : withoutAtPrefix.startsWith("~/")
      ? resolve(homedir(), withoutAtPrefix.slice(2))
      : withoutAtPrefix;
  return resolve(cwd, expandedPath);
}

async function readContent(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function validateEdit(input: EditToolInput, cwd: string): Promise<string | undefined> {
  try {
    const rawContent = await readFile(resolveToolPath(input.path, cwd), "utf8");
    const { text: content } = stripBom(rawContent);
    applyEditsToNormalizedContent(normalizeToLF(content), input.edits, input.path);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function createReview(targetPath: string, previous: string, proposed: string): Promise<Review> {
  const directory = await mkdtemp(join(tmpdir(), "pi-diff-"));
  const extension = extname(targetPath);
  const previousFile = join(directory, `previous${extension}`);
  const proposedFile = join(directory, `proposed${extension}`);
  const commentsFile = join(directory, "comments.jsonl");

  await Promise.all([
    writeFile(previousFile, previous, "utf8"),
    writeFile(proposedFile, proposed, "utf8"),
  ]);

  return { directory, previousFile, proposedFile, commentsFile };
}

async function createEditReview(
  input: EditToolInput,
  targetPath: string,
  ctx: ExtensionContext,
): Promise<Review> {
  const previous = await readContent(targetPath);
  const review = await createReview(targetPath, previous, previous);
  const editTool = createEditToolDefinition(ctx.cwd);
  await editTool.execute(
    "review",
    { path: review.proposedFile, edits: input.edits },
    ctx.signal,
    undefined,
    ctx,
  );
  return review;
}

async function reviewChange(
  pi: ExtensionAPI,
  review: Review,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    await pi.exec(
      "zellij",
      [
        "action",
        "new-pane",
        "--floating",
        "--width",
        "95%",
        "--height",
        "95%",
        "--blocking",
        "--close-on-exit",
        "--",
        "nvim",
        review.proposedFile,
        "-c",
        diffCommand(review),
      ],
      signal ? { signal } : {},
    );
    try {
      const comments = await readFile(review.commentsFile, "utf8");
      return comments.trim() === "" ? undefined : comments;
    } catch {
      return undefined;
    }
  } finally {
    await rm(review.directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

type ReviewComment = {
  comment: string;
  line: number;
  suggested_change: string;
};

type ReviewDetails = {
  comments: ReviewComment[];
  language?: string;
};

function parseReview(content: string): ReviewComment[] | undefined {
  try {
    const comments = content.trim().split(/\r?\n/).map((line) => JSON.parse(line) as unknown);
    return comments.every(isReviewComment) ? comments : undefined;
  } catch {
    return undefined;
  }
}

function isReviewComment(value: unknown): value is ReviewComment {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const comment = value as Partial<ReviewComment>;
  return typeof comment.comment === "string"
    && typeof comment.line === "number"
    && typeof comment.suggested_change === "string";
}

function renderReviewComment(
  comment: ReviewComment,
  language: string | undefined,
  theme: Theme,
): Box {
  const gutter = `${String(comment.line).padStart(4)} | `;
  const output = new Box(0, 0);
  output.addChild(new Markdown(
    `\`\`\`${language ?? "text"}\n${comment.suggested_change}\n\`\`\``,
    0,
    0,
    { ...getMarkdownTheme(), codeBlockIndent: theme.fg("dim", gutter) },
  ));
  output.addChild(new Text(`${" ".repeat(gutter.length)}${theme.fg("toolOutput", comment.comment)}`, 0, 0));
  output.addChild(new Text("", 0, 0));
  return output;
}

function renderReview(
  comments: ReviewComment[],
  language: string | undefined,
  theme: Theme,
): Box {
  const output = new Box(1, 0);
  output.addChild(new Text(theme.fg("accent", theme.bold("Review comments")), 0, 0));
  output.addChild(new Text(theme.fg("muted", `${comments.length} comments`), 0, 0));
  output.addChild(new Text("", 0, 0));
  for (const comment of comments) {
    output.addChild(renderReviewComment(comment, language, theme));
  }
  return output;
}

export default function (pi: ExtensionAPI) {
  let approvalsDisabled = false;
  const setApprovalStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus("auto-write", `auto-write:${approvalsDisabled}`);
  }

  const toggleApprovals = (ctx: ExtensionContext) => {
    approvalsDisabled = !approvalsDisabled;
    setApprovalStatus(ctx);
    ctx.ui.notify(
      `Write and edit approvals disabled: ${ctx.ui.theme.fg("toolTitle", String(approvalsDisabled))}`,
      "info",
    );
  };

  pi.on("session_start", (_event, ctx) => {
    approvalsDisabled = false;
    setApprovalStatus(ctx);
  });

  pi.registerShortcut(Key.ctrl("a"), {
    description: "Disable write and edit approvals",
    handler: (ctx) => {
      toggleApprovals(ctx);
    },
  });

  pi.registerMessageRenderer<ReviewDetails>("review", (message, _options, theme) =>
    renderReview(message.details?.comments ?? [], message.details?.language, theme),
  );

  pi.on("tool_call", async (event, ctx) => {
    const toolCall = isToolCallEventType<"edit", EditToolInput>("edit", event)
      ? { toolName: "edit" as const, input: event.input }
      : isToolCallEventType<"write", WriteToolInput>("write", event)
        ? { toolName: "write" as const, input: event.input }
        : undefined;

    if (!toolCall || approvalsDisabled) {
      return undefined;
    }

    if (toolCall.toolName === "edit") {
      const error = await validateEdit(toolCall.input, ctx.cwd);
      if (error) {
        ctx.ui.notify("Edit validation failed: allowing tool call through to standard validator", "warning");
        return undefined;
      }
    }

    const defaultReason = `${toolCall.toolName} was denied by the user`;
    const reviewInEditor = async (): Promise<Approval | undefined> => {
      const targetPath = resolveToolPath(toolCall.input.path, ctx.cwd);

      const review = toolCall.toolName === "edit"
        ? await createEditReview(toolCall.input, targetPath, ctx)
        : await createReview(targetPath, await readContent(targetPath), toolCall.input.content);
      const comments = await reviewChange(pi, review, ctx.signal);
      const reviewDetails = comments ? parseReview(comments) : undefined;

      if (!reviewDetails) {
        // No review comments means we should just return to the approvial tui
        return undefined
      }

      const language = getLanguageFromPath(targetPath);
      pi.sendMessage({
        customType: "review",
        content: comments ?? "",
        details: language
          ? { comments: reviewDetails, language }
          : { comments: reviewDetails },
        display: true,
      });

      return {
        approved: false,
        reason: reviewDetails ? "Review comments were submitted." : defaultReason,
      };
    };

    const approvalResult = await approval(
      ctx,
      ctx.ui.theme.fg("accent", ctx.ui.theme.bold(`Approve ${toolCall.toolName}?`)),
      ctx.ui.theme.fg("muted", toolCall.input.path),
      defaultReason,
      [
        {
          key: Key.ctrl("a"),
          display: "disable approvals",
          onSelect: () => {
            toggleApprovals(ctx);
            return { approved: true };
          },
        },
        {
          key: Key.ctrl("r"),
          display: "review in editor",
          onSelect: reviewInEditor,
        },
      ],
    );
    if (approvalResult.approved) {
      return undefined;
    }

    return { block: true, reason: approvalResult.reason };
  });
}
