import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  createEditTool,
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
import {
  approval,
  NO_OPTION,
  YES_OPTION,
  type Approval,
  type ApprovalOption,
} from "./components/approval.ts";

type Review = {
  directory: string;
  previousFile: string;
  proposedFile: string;
  commentsFile: string;
  paneId?: string;
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

async function validateWrite(input: WriteToolInput, cwd: string): Promise<string | undefined> {
  try {
    await lstat(resolveToolPath(input.path, cwd));
    return `Cannot write "${input.path}": the target already exists. Use edit to modify existing files.`;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    return error instanceof Error ? error.message : String(error);
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

  try {
    await writeFile(previousFile, previous, "utf8");
    await writeFile(proposedFile, proposed, "utf8");
    return { directory, previousFile, proposedFile, commentsFile };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function createEditReview(
  input: EditToolInput,
  targetPath: string,
  ctx: ExtensionContext,
): Promise<Review> {
  const previous = await readContent(targetPath);
  const review = await createReview(targetPath, previous, previous);
  try {
    const editTool = createEditTool(ctx.cwd);
    await editTool.execute(
      "review",
      { path: review.proposedFile, edits: input.edits },
      ctx.signal,
    );
    return review;
  } catch (error) {
    await rm(review.directory, { recursive: true, force: true });
    throw error;
  }
}

async function initReviewPane(pi: ExtensionAPI, review: Review): Promise<string> {
  // Let creation finish so cancellation can close the returned pane ID.
  const result = await pi.exec("zellij", [
    "action",
    "new-pane",
    "--floating",
    "--no-focus",
    "--width",
    "95%",
    "--height",
    "95%",
    "--close-on-exit",
    "--",
    "nvim",
    review.proposedFile,
    "-c",
    diffCommand(review),
  ]);
  const paneId = result.stdout.trim();
  if (result.code !== 0 || !/^terminal_\d+$/.test(paneId)) {
    throw new Error(result.stderr.trim() || "Zellij did not return a review pane ID.");
  }
  return paneId;
}

async function isReviewPaneOpen(
  pi: ExtensionAPI,
  review: Review,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!review.paneId) {
    return false;
  }
  const result = await pi.exec("zellij", ["action", "list-panes", "--json"], {
    timeout: 5000,
    ...(signal ? { signal } : {}),
  });
  signal?.throwIfAborted();
  if (result.code !== 0 || result.killed) {
    throw new Error(result.stderr.trim() || "Could not check the review pane.");
  }
  const panes = JSON.parse(result.stdout) as { id: number; is_plugin: boolean }[];
  return panes.some((pane) => !pane.is_plugin && `terminal_${pane.id}` === review.paneId);
}

async function reviewChange(
  pi: ExtensionAPI,
  review: Review,
  signal: AbortSignal,
): Promise<string | undefined> {
  signal.throwIfAborted();
  if (!await isReviewPaneOpen(pi, review, signal)) {
    review.paneId = await initReviewPane(pi, review);
  }
  signal.throwIfAborted();
  const result = await pi.exec("zellij", ["action", "focus-pane-id", review.paneId!], { signal });
  signal.throwIfAborted();
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Could not focus the review pane.");
  }
  while (await isReviewPaneOpen(pi, review, signal)) {
    await delay(200, undefined, { signal });
  }
  const comments = await readContent(review.commentsFile);
  return comments.trim() === "" ? undefined : comments;
}

async function closeReview(pi: ExtensionAPI, review: Review): Promise<void> {
  try {
    if (await isReviewPaneOpen(pi, review)) {
      const result = await pi.exec("zellij", ["action", "close-pane", "--pane-id", review.paneId!], { timeout: 5000 });
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || "Could not close the review pane.");
      }
    }
  } finally {
    await rm(review.directory, { recursive: true, force: true });
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

function hasMultipleChanges(ctx: ExtensionContext, toolCallId: string): boolean {
  const entry = ctx.sessionManager.getBranch().findLast((entry) =>
    entry.type === "message" && entry.message.role === "assistant",
  );
  if (entry?.type !== "message" || entry.message.role !== "assistant") {
    return false;
  }

  const calls = entry.message.content.filter((content) => content.type === "toolCall");
  return calls.some((call) => call.id === toolCallId)
    && calls.filter((call) => call.name === "write" || call.name === "edit").length > 1;
}

export default function (pi: ExtensionAPI) {
  const reviewCleanups = new Set<() => Promise<void>>();
  pi.on("session_shutdown", async () => {
    await Promise.all([...reviewCleanups].map((cleanup) => cleanup()));
  });

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

    if (!toolCall) {
      return undefined;
    }

    if (toolCall.toolName === "write") {
      const error = await validateWrite(toolCall.input, ctx.cwd);
      if (error) {
        return { block: true, reason: error };
      }
    }

    if (approvalsDisabled) {
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
    const targetPath = resolveToolPath(toolCall.input.path, ctx.cwd);
    const canReview = ctx.mode === "tui" && process.env.ZELLIJ !== undefined;
    const signal = ctx.signal;
    const reviewAbort = new AbortController();
    let review: Review | undefined;
    let reviewError: unknown;
    let reviewTask: Promise<Approval | undefined> | undefined;
    let cleanupTask: Promise<void> | undefined;

    const prepareReview = async () => {
      review = toolCall.toolName === "edit"
        ? await createEditReview(toolCall.input, targetPath, ctx)
        : await createReview(targetPath, await readContent(targetPath), toolCall.input.content);
      if (!reviewAbort.signal.aborted) {
        review.paneId = await initReviewPane(pi, review);
      }
    };
    const reviewReady = canReview
      ? prepareReview().catch((error: unknown) => { reviewError = error; })
      : Promise.resolve();
    const cleanup = (): Promise<void> => {
      cleanupTask ??= (async () => {
        reviewAbort.abort();
        await reviewReady;
        await reviewTask?.catch(() => undefined);
        if (review) {
          await closeReview(pi, review);
        }
      })().catch((error: unknown) => {
        ctx.ui.notify(`Could not clean up editor review: ${String(error)}`, "warning");
      });
      return cleanupTask;
    };
    const onAbort = () => { void cleanup(); };
    reviewCleanups.add(cleanup);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }

    const reviewInEditor = async (): Promise<Approval | undefined> => {
      await reviewReady;
      reviewAbort.signal.throwIfAborted();
      if (reviewError || !review) {
        ctx.ui.notify(`Could not preload editor review: ${String(reviewError)}`, "error");
        return undefined;
      }
      const comments = await reviewChange(pi, review, reviewAbort.signal);
      reviewAbort.signal.throwIfAborted();
      const reviewDetails = comments ? parseReview(comments) : undefined;

      if (!reviewDetails) {
        review.paneId = await initReviewPane(pi, review);
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

      let reason = defaultReason;
      if (reviewDetails) {
        reason = "Review comments were submitted.";
        if (toolCall.toolName === "write") {
          reason += " The file was not written.";
        }
      }

      return {
        approved: false,
        reason,
      };
    };

    const options: ApprovalOption[] = [
      YES_OPTION,
      NO_OPTION,
    ];
    if (hasMultipleChanges(ctx, event.toolCallId)) {
      options.push({
        display: "Reject all",
        onSelect: () => {
          ctx.abort();
          return {
            approved: false,
            reason: "The user rejected this change and stopped the current run.",
          };
        },
      });
    }

    try {
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
          ...(canReview ? [{
            key: Key.ctrl("r"),
            display: "review in editor",
            onSelect: async () => {
              if (reviewTask || reviewAbort.signal.aborted) {
                return undefined;
              }
              reviewTask = reviewInEditor();
              try {
                return await reviewTask;
              } finally {
                reviewTask = undefined;
              }
            },
          }] : []),
        ],
        options,
      );
      if (signal?.aborted) {
        return { block: true, reason: defaultReason };
      }
      if (approvalResult.approved) {
        return undefined;
      }

      return { block: true, reason: approvalResult.reason };
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await cleanup();
      reviewCleanups.delete(cleanup);
    }
  });
}
