import { createRequire } from "node:module";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Language, Parser, Query, type Node } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const { parser, commandsQuery, redirectsQuery } = await loadParser();

type AllowedCommand = {
  name: string;
  allowedCommands?: Set<AllowedCommand>;
  blockedCommands?: Set<string>;
};

const allowedCommands = new Set<AllowedCommand>([
  { name: "ls" },
  { name: "cat" },
  { name: "head" },
  { name: "tail" },
  { name: "grep" },
  { name: "rg" },
  {
    name: "fd",
    blockedCommands: new Set(["--exec", "-x", "--exec-batch", "-X"]),
  },
  {
    name: "find",
    blockedCommands: new Set([
      "-delete",
      "-exec",
      "-execdir",
      "-ok",
      "-okdir",
      "-fprint",
      "-fprint0",
      "-fprintf",
    ]),
  },
  { name: "tree", blockedCommands: new Set(["-o"]) },
  { name: "wc" },
  { name: "stat" },
  { name: "file" },
  { name: "pwd" },
  { name: "which" },
  { name: "echo" },
  { name: "diff" },
  { name: "glean-cli" },
  {
    name: "git",
    allowedCommands: new Set([
      { name: "status" },
      { name: "diff", blockedCommands: new Set(["--output"]) },
      { name: "log", blockedCommands: new Set(["--output"]) },
      { name: "show", blockedCommands: new Set(["--output"]) },
      {
        name: "branch",
        blockedCommands: new Set([
          "-d",
          "-D",
          "-m",
          "-M",
          "-c",
          "-C",
          "--delete",
          "--move",
          "--copy",
          "--edit-description",
          "--set-upstream-to",
          "--unset-upstream",
        ]),
      },
    ]),
  },
]);

async function loadParser(): Promise<{
  parser: Parser;
  commandsQuery: Query;
  redirectsQuery: Query;
}> {
  await Parser.init();
  const language = await Language.load(
    require.resolve("tree-sitter-bash/tree-sitter-bash.wasm"),
  );
  const parser = new Parser();
  parser.setLanguage(language);
  const commandsQuery = new Query(language, "(command) @command");
  const redirectsQuery = new Query(language, "(file_redirect) @redirect");
  return { parser, commandsQuery, redirectsQuery };
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") {
      return undefined;
    }

    const command = (event.input as { command?: unknown }).command;
    if (typeof command !== "string" || isAllowed(command)) {
      return undefined;
    }
    return requestApproval(ctx, "Approve bash command?", command);
  });
}

function isAllowed(command: string): boolean {
  const tree = parser.parse(command);
  if (!tree || tree.rootNode.hasError) {
    return false;
  }

  const redirects = redirectsQuery
    .captures(tree.rootNode)
    .map((capture) => capture.node);

  if (redirects.some(isFileWritingRedirect)) {
    return false;
  }

  const commands = commandsQuery
    .captures(tree.rootNode)
    .map((capture) => capture.node);

  return commands.length > 0 && commands.every(isCommandAllowed);
}

function isCommandAllowed(command: Node): boolean {
  const nameNode = command.childForFieldName("name");
  if (!nameNode || nameNode.type !== "command_name") {
    return false;
  }

  const arguments_ = command.childrenForFieldName("argument").map((node) => node.text);
  return matchesAllowedCommand(nameNode.text, arguments_, allowedCommands);
}

function isFileWritingRedirect(redirect: Node): boolean {
  const operator = redirect.children.find((child) => !child.isNamed)?.type;

  // Missing operators cannot be classified as writes
  if (!operator) {
    return false;
  }

  // Numeric destinations will duplicate given descriptors instead of creating files
  if (operator === ">&") {
    return redirect.childForFieldName("destination")?.type !== "number";
  }

  // These operators may create, truncate, or append to files
  return [">", ">>", ">|", "<>", "&>", "&>>"].includes(operator);
}

function matchesAllowedCommand(
  name: string,
  arguments_: string[],
  allowed: Set<AllowedCommand>,
): boolean {
  const match = [...allowed].find((item) => item.name === name);
  if (!match) {
    return false;
  }
  if (
    match.blockedCommands &&
    arguments_.some((argument) =>
      match.blockedCommands?.has(argument.split("=", 1)[0] ?? ""),
    )
  ) {
    return false;
  }
  if (!match.allowedCommands) {
    return true;
  }

  const [next, ...remaining] = arguments_;
  return next !== undefined && matchesAllowedCommand(next, remaining, match.allowedCommands);
}

async function requestApproval(
  ctx: ExtensionContext,
  title: string,
  message: string,
) {
  if (!ctx.hasUI) {
    return {
      block: true,
      reason: `${title} Approval is unavailable without an interactive UI: ${message}`,
    };
  }

  const approved = await ctx.ui.confirm(title, message);
  return approved
    ? undefined
    : { block: true, reason: "Operation was denied by the user" };
}
