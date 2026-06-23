import type { Plugin } from "@opencode-ai/plugin"

const commentPatterns: Record<string, RegExp> = {
  ".go": /\/\/|\/\*/,
  ".js": /\/\/|\/\*/,
  ".jsx": /\/\/|\/\*/,
  ".mjs": /\/\/|\/\*/,
  ".py": /#/,
  ".rs": /\/\/|\/\*/,
  ".ts": /\/\/|\/\*/,
  ".tsx": /\/\/|\/\*/,
  ".zig": /\/\//,
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

      if (pattern?.test(write.text)) {
        throw new Error(`Blocked ${input.tool}: comments are not allowed in ${write.path ?? "code"}`)
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
