import { appendFile, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { parsePatch } from "diff"

const commentPatterns: Record<string, RegExp> = {
  ".go": /^\s*(?:\x2f\x2f|\x2f\*)/,
  ".js": /^\s*(?:\x2f\x2f|\x2f\*)/,
  ".jsx": /^\s*(?:\x2f\x2f|\x2f\*)/,
  ".mjs": /^\s*(?:\x2f\x2f|\x2f\*)/,
  ".py": /^\s*#/,
  ".rs": /^\s*(?:\x2f\x2f|\x2f\*)/,
  ".ts": /^\s*(?:\x2f\x2f|\x2f\*)/,
  ".tsx": /^\s*(?:\x2f\x2f|\x2f\*)/,
  ".zig": /^\s*\x2f\x2f/,
}

const blockedText = /\u2014/
const blockedTextMessage = "Reword without em dash characters."

type Write = { path?: string; text: string }
type EditArgs = { filePath: string; oldString: string, newString: string }
type WriteArgs = { filePath: string; content: string }
type PatchArgs = { patchText: string }

export default (async () => ({
  "experimental.text.complete": async (_, output) => {
    return;
    rejectBlockedText(output.text)
  },
  "tool.execute.before": async (input, output) => {
    return;
    switch (input.tool) {
      case "edit":
        await rejectEdit(output.args)
        break
      case "write":
        await rejectWrite(output.args)
        break
      case "apply_patch":
        await rejectPatch(output.args)
        break
    }
  },
})) satisfies Plugin

function rejectBlockedText(value: string, source = "model output") {
  if (blockedText.test(value)) {
    throw new Error(`Blocked ${source}: ${blockedTextMessage}`)
  }
}

async function hasNewComment(write: Write, pattern: RegExp): Promise<boolean> {
  const previousLines = await linesForExistingFile(write.path)

  for (const line of write.text.split(/\r?\n/)) {
    if (pattern.test(line) && !previousLines.has(line)) {
      return true
    }
  }

  return false
}

async function linesForExistingFile(path?: string): Promise<Set<string>> {
  if (!path) {
    return new Set()
  }

  try {
    return new Set((await readFile(resolve(path), "utf8")).split(/\r?\n/))
  } catch {
    return new Set()
  }
}

async function rejectEdit(args: EditArgs) {

  const oldCmt = commentPatterns['js'].exec(args.oldString)
  const newCmt = commentPatterns['js'].exec(args.newString)

  if (!newCmt) {
    return
  }

  for (var cmt of newCmt) {
    if (oldCmt && oldCmt.includes(cmt)) {
      continue
    }
    throw new Error(`Blocked edit: new comments are not allowed in ${args.filePath} please reattempt the edit without comments`)
  }
}

async function rejectWrite(args: WriteArgs) {
  if (!args || typeof args !== "object") {
    return
  }

  const path = args.filePath
  const text = args.content

  if (typeof text !== "string") {
    return
  }

  const write = { path: typeof path === "string" ? path : undefined, text }

  rejectBlockedText(write.text, "write")

  const pattern = patternForPath(write.path)

  if (pattern && await hasNewComment(write, pattern)) {
    throw new Error(`Blocked write: new comments are not allowed in ${write.path ?? "code"} please reattempt the write without comments`)
  }
}

async function rejectPatch(args: PatchArgs) {
  if (!args || typeof args !== "object") {
    return
  }

  const patchText = args.patchText

  if (typeof patchText !== "string") {
    return
  }

  for (const patch of parsePatch(patchText)) {
    const path = patch.newFileName?.replace(/^b\//, "")
    const pattern = patternForPath(path)

    if (!pattern) {
      continue
    }

    for (const hunk of patch.hunks) {
      const oldText = hunk.lines
        .filter((line) => !line.startsWith("+"))
        .map((line) => line.slice(1))
        .join("\n")
      const newText = hunk.lines
        .filter((line) => !line.startsWith("-"))
        .map((line) => line.slice(1))
        .join("\n")
      const oldCmt = pattern.exec(oldText)
      const newCmt = pattern.exec(newText)

      if (!newCmt) {
        continue
      }

      rejectBlockedText(newText, "apply_patch")

      for (const cmt of newCmt) {
        if (oldCmt && oldCmt.includes(cmt)) {
          continue
        }

        throw new Error(`Blocked apply_patch: new comments are not allowed in ${path ?? "code"} please reattempt the patch without comments`)
      }
    }
  }
}

function patternForPath(path?: string): RegExp | undefined {
  const extension = path?.toLowerCase().match(/\.[^.\/]+$/)?.[0]
  return extension ? commentPatterns[extension] : undefined
}
