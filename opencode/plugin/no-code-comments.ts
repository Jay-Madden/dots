import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

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

const toolWrites: Record<string, (args: unknown) => Write[]> = {
  edit: (args) => writeFromArgs(args, "filePath", "newString"),
  write: (args) => writeFromArgs(args, "filePath", "content"),
  apply_patch: patchWrites,
}

export default (async () => ({
  "experimental.text.complete": async (_, output) => {
    rejectBlockedText(output.text)
  },
  "tool.execute.before": async (input, output) => {
    for (const write of writesForTool(input.tool, output.args)) {
      rejectBlockedText(write.text, input.tool)

      const pattern = patternForPath(write.path)

      if (pattern && await hasNewComment(write, pattern)) {
        throw new Error(`Blocked ${input.tool}: new comments are not allowed in ${write.path ?? "code"} please reattempt the patch without comments`)
      }
    }
  },
})) satisfies Plugin

function rejectBlockedText(value: string, source = "model output") {
  if (blockedText.test(value)) {
    throw new Error(`Blocked ${source}: ${blockedTextMessage}`)
  }
}

function writesForTool(tool: string, args: unknown): Array<{ path?: string; text: string }> {
  return toolWrites[tool]?.(args) ?? []
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

function writeFromArgs(args: unknown, pathKey: string, textKey: string): Write[] {
  if (!args || typeof args !== "object") {
    return []
  }

  const record = args as Record<string, unknown>
  const path = record[pathKey]
  const text = record[textKey]

  if (typeof text !== "string") {
    return []
  }

  return [{ path: typeof path === "string" ? path : undefined, text }]
}

function patchWrites(args: unknown): Array<{ path?: string; text: string }> {
  if (!args || typeof args !== "object") {
    return []
  }

  const patchText = (args as Record<string, unknown>).patchText

  if (typeof patchText !== "string") {
    return []
  }

  const writes: Array<{ path?: string; text: string }> = []
  let path: string | undefined

  for (const line of patchText.split(/\r?\n/)) {
    const file = line.match(/^\*\*\* (?:Add|Update) File: (.+)$/)

    if (file) {
      path = file[1]
      continue
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      writes.push({ path, text: line.slice(1) })
    }
  }

  return writes
}

function patternForPath(path?: string): RegExp | undefined {
  const extension = path?.toLowerCase().match(/\.[^.\/]+$/)?.[0]
  return extension ? commentPatterns[extension] : undefined
}
