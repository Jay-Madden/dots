import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  EditToolInput,
  ExtensionAPI,
  ExtensionContext,
  ReadToolInput,
  WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type {
  Diagnostic,
  PublishDiagnosticsParams,
} from "vscode-languageserver-protocol";
import { DiagnosticSeverity } from "vscode-languageserver-protocol";
import {
  commands,
  languageByExtension,
  LspClient,
  type LspLanguage,
} from "./client.ts";

type DiagnosticDetails = {
  serverName: string;
  file: string;
  count: number;
  diagnostics: string;
  remaining: number;
};

const automaticDiagnosticLimit = 10;
const diagnosticsToolName = "get_diagnostics";

export default function (pi: ExtensionAPI) {
  const clients: LspClient[] = [];
  let cwd: string | undefined;
  const versions = new Map<string, number>();
  const published = new Map<string, string>();

  const showAllRequests = new Set<string>();

  pi.registerMessageRenderer<DiagnosticDetails>(
    "lsp-diagnostics",
    (message, options, theme) => {
      const details = message.details as DiagnosticDetails;
      const remainingLabel = details.remaining > 0
        ? ` (${details.remaining} more available)`
        : "";
      const label = `${details.serverName}: ${details.count} error${details.count === 1 ? "" : "s"} in ${details.file}${remainingLabel}`;
      const text = options.expanded
        ? `${theme.fg("error", label)}\n${theme.fg("dim", details.diagnostics)}`
        : theme.fg("dim", label);
      return new Text(text, 1, 0);
    },
  );

  pi.registerTool({
    name: diagnosticsToolName,
    label: "Get Diagnostics",
    description: "Refresh a file and return all current LSP error diagnostics.",
    parameters: Type.Object({
      path: Type.String({
        description: "File path relative to the current working directory",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const path = params.path.replace(/^@/, "");
      const language = languageByExtension[extname(path).toLowerCase()];
      if (!language) {
        throw new Error(`No language server configured for ${path}`);
      }

      const file = resolve(ctx.cwd, path);
      const uri = pathToFileURL(file).href;
      const version = (versions.get(uri) ?? 0) + 1;
      showAllRequests.add(uri);
      await syncFile(language, file, ctx.cwd, ctx, version);

      return {
        content: [{
          type: "text",
          text: `Requested fresh diagnostics for ${path}.`,
        }],
        details: { path, version },
      };
    },
  });

  const ensureClient = async (
    language: LspLanguage,
    workspace: string,
    ctx: ExtensionContext,
  ) => {
    const existing = clients.find((client) => client.language === language);
    if (existing) {
      return existing;
    }

    cwd = workspace;
    const serverName = commands[language].name;
    try {
      const active = await LspClient.start({
        language,
        cwd: workspace,
        onDiagnostics: publishDiagnostics,
      });
      clients.push(active);
      ctx.ui.setStatus(
        active.name,
        ctx.ui.theme.fg("dim", `${active.name}:active`),
      );
      return active;
    } catch (error) {
      ctx.ui.setStatus(
        serverName,
        ctx.ui.theme.fg("error", `${serverName}:failed`),
      );
      throw error;
    }
  };

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || !["edit", "read", "write"].includes(event.toolName)) {
      return undefined;
    }

    const input = event.input as EditToolInput | ReadToolInput | WriteToolInput;

    const path = input.path;
    const language = languageByExtension[extname(path).toLowerCase()];
    if (!language) {
      return undefined;
    }

    const file = resolve(ctx.cwd, path.replace(/^@/, ""));
    void syncFile(language, file, ctx.cwd, ctx).catch((error) => {
      ctx.ui.notify(
        error instanceof Error ? error.message : String(error),
        "warning",
      );
    });
    return undefined;
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    for (const active of clients) {
      await active.stop();
      ctx.ui.setStatus(active.name, undefined);
    }
    clients.length = 0;
  });

  async function syncFile(
    language: LspLanguage,
    file: string,
    workspace: string,
    ctx: ExtensionContext,
    requestedVersion?: number,
  ) {
    const active = await ensureClient(language, workspace, ctx);
    const uri = pathToFileURL(file).href;
    const text = await readFile(file, "utf8");
    const version = requestedVersion ?? (versions.get(uri) ?? 0) + 1;
    versions.set(uri, version);

    if (version === 1) {
      active.connection.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId: language, version, text },
      });
      return;
    }

    active.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  function publishDiagnostics(
    serverName: string,
    params: PublishDiagnosticsParams,
  ) {
    if (
      params.version !== undefined &&
      versions.get(params.uri) !== params.version
    ) {
      return;
    }

    const errors = params.diagnostics.filter(
      (diagnostic) => diagnostic.severity === DiagnosticSeverity.Error,
    );
    const showAll = showAllRequests.delete(params.uri);
    const signature = JSON.stringify(errors);
    if (!showAll && published.get(params.uri) === signature) {
      return;
    }
    published.set(params.uri, signature);
    if (errors.length === 0 || !cwd || !params.uri.startsWith("file:")) {
      return;
    }

    const file = relative(cwd, fileURLToPath(params.uri));
    const shown = showAll ? errors : errors.slice(0, automaticDiagnosticLimit);
    const diagnostics = shown.map(formatDiagnostic).join("\n");
    const remainingCount = errors.length - shown.length;
    const suffix = remainingCount > 0
      ? `\n${remainingCount} more diagnostics are available. Call ${diagnosticsToolName} to retrieve them.`
      : "";

    pi.sendMessage(
      {
        customType: "lsp-diagnostics",
        content: `${serverName} diagnostics for ${file}:\n${diagnostics}${suffix}`,
        display: true,
        details: {
          serverName,
          file,
          count: errors.length,
          diagnostics,
          remaining: remainingCount,
        } satisfies DiagnosticDetails,
      },
      { deliverAs: "steer", triggerTurn: true },
    );
  }
}


function formatDiagnostic(diagnostic: Diagnostic): string {
  const line = diagnostic.range.start.line + 1;
  const column = diagnostic.range.start.character + 1;
  const source = diagnostic.source ? ` [${diagnostic.source}]` : "";
  return `${line}:${column}: ${diagnostic.message}${source}`;
}
