import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { extname, relative, resolve } from "node:path";
import type { EditToolInput, ExtensionAPI, ReadToolInput, WriteToolInput } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

type DiagnosticDetails = {
  file: string;
  count: number;
};

export default function (pi: ExtensionAPI) {
  let process: ChildProcess | undefined;
  let port: number | undefined;
  const generations = new Map<string, number>();

  pi.registerMessageRenderer("lsp-diagnostics", (message, options, theme) => {
    const details = message.details as DiagnosticDetails;
    const label = `gopls: ${details.count} error${details.count === 1 ? "" : "s"} in ${details.file}`;
    const text = options.expanded
      ? `${theme.fg("error", label)}\n${theme.fg("dim", message.content)}`
      : theme.fg("dim", label);
    return new Text(text, 1, 0);
  });

  const ensureServer = async (cwd: string) => {
    if (port && await canConnect(port)) {
      return port;
    }

    port = 50000 + Math.floor(Math.random() * 10000);
    process = spawn(
      "gopls",
      ["serve", "-listen", `127.0.0.1:${port}`, "-listen.timeout", "8h"],
      { cwd, stdio: "ignore" },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    return port;
  };

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || !["edit", "read", "write"].includes(event.toolName)) {
      return undefined;
    }

    const input = event.input as EditToolInput | ReadToolInput | WriteToolInput;

    const path = input.path;
    if (extname(path).toLowerCase() !== ".go") {
      return undefined;
    }

    const file = resolve(ctx.cwd, path.replace(/^@/, ""));
    const generation = (generations.get(file) ?? 0) + 1;
    generations.set(file, generation);

    checkFile(file, ctx.cwd, generation);
    return undefined;
  });

  pi.on("session_shutdown", async () => {
    process?.kill();
  });

  async function checkFile(file: string, cwd: string, generation: number) {
    const activePort = await ensureServer(cwd);
    const result = await pi.exec(
      "gopls",
      ["-remote", `127.0.0.1:${activePort}`, "check", "-severity=error", file],
      { cwd },
    );
    const diagnostics = [result.stdout, result.stderr]
      .map((output) => output.trim())
      .filter(Boolean)
      .join("\n");

    if (!diagnostics || generations.get(file) !== generation) {
      return;
    }

    const count = diagnostics.split("\n").filter(Boolean).length;
    const displayPath = relative(cwd, file);
    pi.sendMessage(
      {
        customType: "lsp-diagnostics",
        content: `gopls diagnostics for ${displayPath}:\n${diagnostics}`,
        display: true,
        details: { file: displayPath, count } satisfies DiagnosticDetails,
      },
      { deliverAs: "steer", triggerTurn: true },
    );
  }
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
