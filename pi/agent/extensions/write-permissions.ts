import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
  EditToolInput,
  ExtensionAPI,
  WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import {
  applyEditsToNormalizedContent,
  normalizeToLF,
  stripBom,
} from "./vendor/edit-diff.ts";
import { approval } from "./components/approval.ts";

function resolveToolPath(path: string, cwd: string): string {
  const withoutAtPrefix = path.startsWith("@") ? path.slice(1) : path;
  const expandedPath = withoutAtPrefix === "~"
    ? homedir()
    : withoutAtPrefix.startsWith("~/")
      ? resolve(homedir(), withoutAtPrefix.slice(2))
      : withoutAtPrefix;
  return resolve(cwd, expandedPath);
}

async function validateEdit(input: EditToolInput, cwd: string): Promise<string | undefined> {
  const rawContent = await readFile(resolveToolPath(input.path, cwd), "utf8");
  const { text: content } = stripBom(rawContent);

  try {
    applyEditsToNormalizedContent(normalizeToLF(content), input.edits, input.path);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") {
      return undefined;
    }

    const input = event.input as EditToolInput | WriteToolInput;

    if (event.toolName === "edit") {
      const error = await validateEdit(input as EditToolInput, ctx.cwd);
      if (error) {
        ctx.ui.notify(`Edit validation failed: allowing tool call through to standard validator`, "warning");
        return undefined;
      }
    }

    const result = await approval(
      ctx,
      ctx.ui.theme.fg("accent", ctx.ui.theme.bold(`Approve ${event.toolName}?`)),
      ctx.ui.theme.fg("muted", input.path),
      `${event.toolName} was denied by the user`,
    );
    return result.approved
      ? undefined
      : { block: true, reason: result.reason };
  });
}
