import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import {
  highlightCode,
  isToolCallEventType,
  keyHint,
  type BashToolInput,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { approval } from "./components/approval.ts";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { Language, Parser, Query, type Node } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const { parser, commandsQuery, redirectsQuery } = await loadParser();

export type AllowedCommand = {
  name: string;
  allowedCommands?: Set<AllowedCommand>;
  blockedCommands?: Set<string>;
};

type ApprovalFindings = {
  commands: string[];
  arguments: string[];
  writes: string[];
};

const allowedCommands = new Set<AllowedCommand>([
  { name: "ls" },
  { name: "cat" },
  { name: "head" },
  { name: "tail" },
  { name: "grep" },
  { name: "rg" },
  { name: "jq" },
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
  { name: "nl" },
  { name: "stat" },
  { name: "file" },
  { name: "sort" },
  { name: "cut" },
  { name: "tr" },
  { name: "sha256sum" },
  { name: "ps" },
  {
    name: "command",
    allowedCommands: new Set([
      { name: "-v" },
      { name: "-V" },
    ]),
  },
  { name: "pwd" },
  { name: "basename" },
  { name: "dirname" },
  { name: "which" },
  { name: "echo" },
  // -v assigns to a shell variable instead of writing to stdout.
  { name: "printf", blockedCommands: new Set(["-v"]) },
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
    name: "go",
    allowedCommands: new Set([
      { name: "version" },
      { name: "env", blockedCommands: new Set(["-w", "-u"]) },
      {
        name: "list",
        blockedCommands: new Set(["-exec", "-mod", "-modfile", "-overlay"]),
      },
      {
        name: "mod",
        allowedCommands: new Set([
          { name: "download" },
          { name: "graph" },
          { name: "why" },
        ]),
      },
    ]),
  },
  {
    name: "cargo",
    allowedCommands: new Set([
      { name: "-V" },
      { name: "--version" },
      { name: "--list" },
      { name: "--explain" },
      { name: "-h" },
      { name: "--help" },
      { name: "version" },
      { name: "help" },
      { name: "info" },
      { name: "locate-project" },
      {
        name: "metadata",
        blockedCommands: new Set(["--lockfile-path"]),
      },
      {
        name: "tree",
        blockedCommands: new Set(["--lockfile-path"]),
      },
      { name: "pkgid" },
      { name: "read-manifest" },
      { name: "search" },
      {
        name: "report",
        allowedCommands: new Set([
          { name: "future-incompat" },
        ]),
      },
      { name: "verify-project" },
      {
        name: "config",
        allowedCommands: new Set([
          { name: "get" },
        ]),
      },
    ]),
  },
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
  {
    name: "glab",
    allowedCommands: new Set([
      {
        name: "mr",
        allowedCommands: new Set([
          { name: "list" },
          { name: "view", blockedCommands: new Set(["--web", "-w"]) },
          { name: "diff" },
        ]),
      },
    ]),
  },
  {
    name: "fj",
    allowedCommands: new Set([
      { name: "-h" },
      { name: "--help" },
      { name: "help" },
      { name: "whoami" },
      { name: "version" },
      { name: "completion" },
      {
        name: "repo",
        allowedCommands: new Set([
          { name: "view" },
          { name: "readme" },
          { name: "star-status" },
          { name: "watch-status" },
          {
            name: "labels",
            allowedCommands: new Set([
              { name: "view" },
            ]),
          },
        ]),
      },
      {
        name: "issue",
        allowedCommands: new Set([
          { name: "search" },
          { name: "view" },
          { name: "templates" },
        ]),
      },
      {
        name: "pr",
        allowedCommands: new Set([
          { name: "search" },
          { name: "view" },
          { name: "status" },
          {
            name: "review",
            allowedCommands: new Set([
              { name: "list" },
            ]),
          },
        ]),
      },
      {
        name: "wiki",
        allowedCommands: new Set([
          { name: "contents" },
          { name: "view" },
        ]),
      },
      {
        name: "actions",
        allowedCommands: new Set([
          { name: "tasks" },
          {
            name: "variables",
            allowedCommands: new Set([
              { name: "list" },
            ]),
          },
          {
            name: "secrets",
            allowedCommands: new Set([
              { name: "list" },
            ]),
          },
        ]),
      },
      {
        name: "auth",
        allowedCommands: new Set([
          { name: "list" },
        ]),
      },
      {
        name: "release",
        allowedCommands: new Set([
          { name: "list" },
          { name: "view" },
        ]),
      },
      {
        name: "tag",
        allowedCommands: new Set([
          { name: "list" },
          { name: "view" },
        ]),
      },
      {
        name: "user",
        allowedCommands: new Set([
          { name: "search" },
          { name: "view" },
          { name: "following" },
          { name: "followers" },
          { name: "repos" },
          { name: "orgs" },
          { name: "activity" },
          {
            name: "key",
            allowedCommands: new Set([
              { name: "list" },
              { name: "view" },
            ]),
          },
          {
            name: "gpg",
            allowedCommands: new Set([
              { name: "list" },
              { name: "view" },
            ]),
          },
        ]),
      },
      {
        name: "org",
        allowedCommands: new Set([
          { name: "list" },
          { name: "view" },
          { name: "members" },
          {
            name: "visibility",
            blockedCommands: new Set(["-s", "--set"]),
          },
          {
            name: "team",
            allowedCommands: new Set([
              { name: "list" },
              { name: "view" },
              {
                name: "repo",
                allowedCommands: new Set([
                  { name: "list" },
                ]),
              },
              {
                name: "member",
                allowedCommands: new Set([
                  { name: "list" },
                ]),
              },
            ]),
          },
          {
            name: "label",
            allowedCommands: new Set([
              { name: "list" },
            ]),
          },
          {
            name: "repo",
            allowedCommands: new Set([
              { name: "list" },
            ]),
          },
        ]),
      },
    ]),
  },
  {
    name: "gh",
    allowedCommands: new Set([
      {
        name: "pr",
        allowedCommands: new Set([
          { name: "list" },
          { name: "view", blockedCommands: new Set(["--web", "-w"]) },
          { name: "diff", blockedCommands: new Set(["--web"]) },
        ]),
      },
      {
        name: "issue",
        allowedCommands: new Set([
          { name: "list" },
          { name: "view", blockedCommands: new Set(["--web", "-w"]) },
        ]),
      },
      {
        name: "run",
        allowedCommands: new Set([
          { name: "view" },
        ]),
      },
    ]),
  },
  ...(await loadLocalAllowedCommands()),
]);

const bashPermissionStateToolName = "bash_permission_state";

async function loadLocalAllowedCommands(): Promise<AllowedCommand[]> {
  const path = new URL("../local/bash-permissions.ts", import.meta.url);
  if (!existsSync(path)) {
    return [];
  }

  const local = await import(path.href) as {
    localAllowedCommands?: Iterable<AllowedCommand>;
  };
  return [...(local.localAllowedCommands ?? [])];
}

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
  pi.registerTool({
    name: bashPermissionStateToolName,
    label: "Bash Permission State",
    description: "Load the current bash extension allowlist and approval rules on demand",
    parameters: Type.Object({}),
    async execute() {
      const bashRules = renderAllowedCommandRules(allowedCommands);
      return {
        content: [{
          type: "text",
          text: bashRules.join("\n"),
        }],
        details: { ruleCount: bashRules.length },
      };
    },
    renderResult(result, { expanded }, theme) {
      const ruleCount = result.details?.ruleCount ?? 0;
      const text = expanded
        ? renderBashPermissionPrompt(allowedCommands)
        : theme.fg(
          "muted",
          `Loaded ${ruleCount} bash permission rules (${keyHint("app.tools.expand", "to expand")})`,
        );
      return new Text(text, 0, 0);
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType<"bash", BashToolInput>("bash", event)) {
      return undefined;
    }

    const { command } = event.input;

    const findings = getApprovalFindings(command);
    const blocked = [
      ...findings.commands,
      ...findings.arguments,
      ...findings.writes,
    ];
    if (blocked.length === 0) {
      return undefined;
    }
    const message = blocked.length === 1 && blocked[0] === command
      ? highlightCode(command, "bash").join("\n")
      : [
          ...highlightCode(command, "bash"),
          "",
          ctx.ui.theme.fg("accent", "Requires approval:"),
          ...renderGroup("Commands", findings.commands, ctx),
          ...renderGroup("Arguments", findings.arguments, ctx),
          ...renderGroup("File writes", findings.writes, ctx),
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

function getApprovalFindings(source: string): ApprovalFindings {
  const tree = parser.parse(source);
  if (!tree || tree.rootNode.hasError) {
    return { commands: [source], arguments: [], writes: [] };
  }

  const commandFindings = commandsQuery
    .captures(tree.rootNode)
    .map((capture) => findingsForCommand(capture.node));

  return {
    commands: Array.from(
      new Set(commandFindings.flatMap((finding) => finding.commands)),
    ),
    arguments: Array.from(
      new Set(commandFindings.flatMap((finding) => finding.arguments)),
    ),
    writes: Array.from(
      new Set(
        redirectsQuery
          .captures(tree.rootNode)
          .map((capture) => capture.node)
          .filter(isFileWritingRedirect)
          .map((redirect) => redirect.parent?.text ?? redirect.text),
      ),
    ),
  };
}

function findingsForCommand(command: Node): Omit<ApprovalFindings, "writes"> {
  const nameNode = command.childForFieldName("name");
  if (!nameNode || nameNode.type !== "command_name") {
    return { commands: [command.text], arguments: [] };
  }

  const arguments_ = command.childrenForFieldName("argument").map((node) => node.text);
  return findingsForAllowedCommand(
    nameNode.text,
    arguments_,
    allowedCommands,
    command.text,
  );
}

function isFileWritingRedirect(redirect: Node): boolean {
  const operator = redirect.children.find((child) => !child.isNamed)?.type;
  const destination = redirect.childForFieldName("destination")?.text;

  // dev null is obviously not an actual write
  if (destination === "/dev/null") {
    return false;
  }

  // Missing operators cant be classified as writes
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

function findingsForAllowedCommand(
  name: string,
  arguments_: string[],
  allowed: Set<AllowedCommand>,
  source: string,
): Omit<ApprovalFindings, "writes"> {
  const matches = [...allowed].filter((item) => item.name === name);
  if (matches.length === 0) {
    return { commands: [source], arguments: [] };
  }

  const findings = matches.map((match) => {
    const hasBlockedArguments = arguments_.some((argument) =>
      match.blockedCommands?.has(argument.split("=", 1)[0] ?? ""),
    );
    const blockedArguments = hasBlockedArguments ? [source] : [];
    if (!match.allowedCommands) {
      return { commands: [], arguments: blockedArguments };
    }

    const [next, ...remaining] = arguments_;
    if (next === undefined) {
      return { commands: [source], arguments: blockedArguments };
    }

    const nested = findingsForAllowedCommand(
      next,
      remaining,
      match.allowedCommands,
      source,
    );
    return {
      commands: nested.commands,
      arguments: [...blockedArguments, ...nested.arguments],
    };
  });

  const allowedFinding = findings.find(
    (finding) => finding.commands.length === 0 && finding.arguments.length === 0,
  );
  return allowedFinding ?? findings.reduce((best, candidate) => {
    const bestCount = best.commands.length + best.arguments.length;
    const candidateCount = candidate.commands.length + candidate.arguments.length;
    if (candidateCount !== bestCount) {
      return candidateCount < bestCount ? candidate : best;
    }
    return candidate.commands.length < best.commands.length ? candidate : best;
  });
}

function renderBashPermissionPrompt(allowed: Set<AllowedCommand>): string {
  return [
    "Bash permission state:",
    "The bash extension runs the command patterns below without interactive approval.",
    "Each pattern permits any remaining arguments unless approval-required arguments are listed.",
    ...renderAllowedCommandRules(allowed),
    "All other commands, unlisted subcommands, approval-required arguments, parse failures, and file-writing redirects require interactive approval.",
    "Redirection to /dev/null is exempt. Commands in pipelines and compound statements are checked independently.",
  ].join("\n");
}

function renderAllowedCommandRules(
  allowed: Set<AllowedCommand>,
  prefix: string[] = [],
  inheritedBlockedArguments: string[] = [],
): string[] {
  return [...allowed].flatMap((command) => {
    const commandPath = [...prefix, command.name];
    const blockedArguments = [
      ...inheritedBlockedArguments,
      ...(command.blockedCommands ?? []),
    ];
    if (command.allowedCommands) {
      return renderAllowedCommandRules(
        command.allowedCommands,
        commandPath,
        blockedArguments,
      );
    }

    const restriction = blockedArguments.length === 0
      ? ""
      : `; approval-required arguments: ${blockedArguments.join(", ")}`;
    return [`- ${commandPath.join(" ")} [args...]${restriction}`];
  });
}

function renderGroup(
  label: string,
  items: string[],
  ctx: Parameters<typeof approval>[0],
): string[] {
  if (items.length === 0) {
    return [];
  }
  return [
    ctx.ui.theme.fg("warning", `  ${label}`),
    ...items.flatMap((item) => highlightCode(`    ${item}`, "bash")),
  ];
}

