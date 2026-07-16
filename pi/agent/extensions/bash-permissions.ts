import { createRequire } from "node:module";
import {
  highlightCode,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { approval } from "./components/approval.ts";
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
  { name: "sort" },
  { name: "pwd" },
  { name: "which" },
  { name: "echo" },
  // ==========
  // Shell control primitives that do not mutate external state.
  { name: "true" },
  { name: "false" },
  { name: ":" },
  { name: "break" },
  { name: "continue" },
  { name: "return" },
  { name: "shift" },
  { name: "test" },
  { name: "[" },
  { name: "[[" },
  // ==========
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
    if (typeof command !== "string") {
      return undefined;
    }

    const blocked = blockedCommands(command);
    if (blocked.length === 0) {
      return undefined;
    }
    const message = blocked.length === 1 && blocked[0] === command
      ? highlightCode(command, "bash").join("\n")
      : [
          ...highlightCode(command, "bash"),
          "",
          ctx.ui.theme.fg("accent", "Requires approval:"),
          ...blocked.flatMap((item) => highlightCode(item, "bash")),
        ].join("\n");
    const result = await approval(
      ctx,
      ctx.ui.theme.fg("accent", ctx.ui.theme.bold("Approve bash command?")),
      message,
      "Bash command was denied by the user",
    );
    return result.approved
      ? undefined
      : { block: true, reason: result.reason };
  });
}

function blockedCommands(source: string): string[] {
  const tree = parser.parse(source);
  if (!tree || tree.rootNode.hasError) {
    return [source];
  }

  const blocked = redirectsQuery
    .captures(tree.rootNode)
    .map((capture) => capture.node)
    .filter(isFileWritingRedirect)
    .map((redirect) => redirect.text);

  blocked.push(
    ...commandsQuery
      .captures(tree.rootNode)
      .map((capture) => capture.node)
      .filter((command) => !isCommandAllowed(command))
      .map((command) => command.text),
  );
  return [...new Set(blocked)];
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
  const destination = redirect.childForFieldName("destination")?.text;

  // dev null is obviously not an actual write
  if (destination === "/dev/null") {
    return false;
  }

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
      // some commands can do --out=foo.txt which we detect here
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

