import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { approval } from "./components/approval.ts";

const commentMarkersByExtension: Record<string, string[]> = {
  ".bash": ["#"],
  ".go": ["//", "/*"],
  ".js": ["//", "/*"],
  ".jsx": ["//", "/*"],
  ".mjs": ["//", "/*"],
  ".py": ["#"],
  ".pyi": ["#"],
  ".rs": ["//", "/*"],
  ".sh": ["#"],
  ".ts": ["//", "/*"],
  ".tsx": ["//", "/*"],
  ".zig": ["//"],
  ".zsh": ["#"],
};

const emDash = "\u2014";

type Edit = {
  oldText: string;
  newText: string;
};

type ToolInput = {
  path: string;
  content: string;
  edits: Edit[];
};

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") {
      return undefined;
    }

    const input = event.input as ToolInput;
    const path = typeof input.path === "string" ? input.path.replace(/^@/, "") : "";
    const changes = editsFor(event.toolName, input);
    const emDashLines = changes.flatMap(({ newText }) => linesContaining(newText, emDash));

    if (emDashLines.length > 0) {
      return { block: true, reason: "Edit contains an em dash" };
    }

    const markers = commentMarkersByExtension[extname(path).toLowerCase()];
    if (markers) {
      const existingLines = event.toolName === "write"
        ? await readExistingLines(path, ctx.cwd)
        : new Set<string>();
      const addedComments = changes.flatMap(({ oldText, newText }) => {
        const priorLines = event.toolName === "write"
          ? existingLines
          : new Set(oldText.split(/\r?\n/));
        const priorComments = new Set([...priorLines].filter((line) => isCommentLine(line, markers)));
        const nextComments = new Set(newText.split(/\r?\n/).filter((line) => isCommentLine(line, markers)));
        if (nextComments.size > priorComments.size) {
          return [...nextComments];
        }
        return [];
      });

      if (addedComments.length > 0) {
        if (!ctx.hasUI) {
          return { block: true, reason: "Comments were denied, please resubmit the patch without comments" };
        }

        const preview = addedComments.slice(0, 5).map((line) => `  ${line}`).join("\n");
        const approve = await approval(
          ctx,
          "Approve code comments?",
          `${ctx.ui.theme.fg("muted", path || "code")}\n\n${preview}`,
          "Comments were denied, please resubmit the patch without comments",
        );
        if (!approve.approved) {
          return { block: true, reason: approve.reason };
        }
      }
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `${event.toolName} requires approval, but no interactive UI is available: ${path || "unknown path"}`,
      };
    } else {
      const approve = await approval(
        ctx,
        `Approve ${event.toolName}?`,
        ctx.ui.theme.fg("muted", path || "unknown path"),
        `${event.toolName} was denied by the user`,
      );
      return approve.approved ? undefined : { block: true, reason: approve.reason };
    }
  });
}


function editsFor(toolName: string, input: ToolInput): Edit[] {
  return toolName === "write"
    ? [{ oldText: "", newText: input.content }]
    : input.edits;
}

function isCommentLine(line: string, markers: string[]): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#!")) {
    return false;
  }
  return markers.some((marker) => trimmed.startsWith(marker));
}

function linesContaining(text: string, value: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.includes(value));
}

async function readExistingLines(path: string, cwd: string): Promise<Set<string>> {
  if (!path) {
    return new Set();
  }

  try {
    const content = await readFile(resolve(cwd, path), "utf8");
    return new Set(content.split(/\r?\n/));
  } catch {
    return new Set();
  }
}

