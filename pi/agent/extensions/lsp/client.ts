import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createMessageConnection,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import type {
  InitializeParams,
  InitializeResult,
  PublishDiagnosticsParams,
} from "vscode-languageserver-protocol";

export type LspLanguage =
  | "javascript"
  | "typescript"
  | "python"
  | "go"
  | "yaml"
  | "rust"
  | "lua"
  | "bash";

export const languageByExtension: Record<string, LspLanguage> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".rs": "rust",
  ".lua": "lua",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
};

type LspCommand = {
  name: string;
  command: string;
  args: string[];
};

export type LspClientOptions = {
  language: LspLanguage;
  cwd: string;
  onDiagnostics?: (
    serverName: string,
    params: PublishDiagnosticsParams,
  ) => void;
};

export const commands: Record<LspLanguage, LspCommand> = {
  javascript: { name: "vtsls", command: "vtsls", args: ["--stdio"] },
  typescript: { name: "vtsls", command: "vtsls", args: ["--stdio"] },
  python: { name: "ty", command: "ty", args: ["server"] },
  go: { name: "gopls", command: "gopls", args: ["serve"] },
  yaml: {
    name: "yaml-language-server",
    command: "yaml-language-server",
    args: ["--stdio"],
  },
  rust: { name: "rust-analyzer", command: "rust-analyzer", args: [] },
  lua: {
    name: "lua-language-server",
    command: "lua-language-server",
    args: [],
  },
  bash: {
    name: "bashls",
    command: "bash-language-server",
    args: ["start"],
  },
};

export class LspClient {
  readonly name: string;
  readonly language: LspLanguage;
  readonly process: ChildProcessWithoutNullStreams;
  readonly connection: MessageConnection;
  private stopped = false;

  private constructor(
    name: string,
    language: LspLanguage,
    process: ChildProcessWithoutNullStreams,
    connection: MessageConnection,
  ) {
    this.name = name;
    this.language = language;
    this.process = process;
    this.connection = connection;
  }

  static async start(options: LspClientOptions): Promise<LspClient> {
    const command = commands[options.language];
    const process = spawn(command.command, command.args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      process.once("spawn", resolve);
      process.once("error", reject);
    });
    process.stderr.resume();
    const connection = createMessageConnection(process.stdout, process.stdin);
    const client = new LspClient(
      command.name,
      options.language,
      process,
      connection,
    );

    connection.onRequest(
      "workspace/configuration",
      (params: { items?: unknown[] }) => (params.items ?? []).map(() => ({})),
    );
    connection.onRequest("client/registerCapability", () => null);
    connection.onRequest("window/workDoneProgress/create", () => null);
    if (options.onDiagnostics) {
      connection.onNotification(
        "textDocument/publishDiagnostics",
        (params: PublishDiagnosticsParams) =>
          options.onDiagnostics?.(client.name, params),
      );
    }
    connection.listen();

    const rootUri = pathToFileURL(options.cwd).href;
    const params: InitializeParams = {
      processId: globalThis.process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: basename(options.cwd) }],
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: { publishDiagnostics: {} },
      },
    };
    await connection.sendRequest<InitializeResult>("initialize", params);
    connection.sendNotification("initialized", {});
    return client;
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.connection.dispose();
    this.process.kill();
  }
}
