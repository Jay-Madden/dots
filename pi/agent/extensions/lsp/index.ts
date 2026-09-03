import { readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type EditToolInput,
  type ExtensionAPI,
  generateDiffString,
  type ExtensionContext,
  isReadToolResult,
  keyHint,
  type ReadToolInput,
  type WriteToolInput,
  renderDiff,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type {
  Diagnostic,
  PrepareRenameResult,
  PublishDiagnosticsParams,
  TextDocumentEdit,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver-protocol";
import { DiagnosticSeverity } from "vscode-languageserver-protocol";
import { TextDocument } from "vscode-languageserver-textdocument";
import { approval } from "../components/approval.ts";
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

type DocumentState = {
  version: number;
  text?: string;
  diagnostics: {
    version: number | undefined;
    items: Diagnostic[];
  };
};

const automaticDiagnosticLimit = 10;
const diagnosticsToolName = "get_diagnostics";

export default function (pi: ExtensionAPI) {
  const clients: LspClient[] = [];
  let cwd: string | undefined;
  const documents = new Map<string, DocumentState>();
  const published = new Map<string, string>();

  const showAllRequests = new Set<string>();

  pi.registerTool({
    name: "rename_symbol",
    label: "Rename Symbol",
    description: "Rename a symbol using the language server. The file must have been read first. Line and column are 1-based.",
    parameters: Type.Object({
      path: Type.String(),
      line: Type.Integer({ minimum: 1 }),
      column: Type.Integer({ minimum: 1 }),
      newName: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const path = params.path.replace(/^@/, "");
      const file = resolve(ctx.cwd, path);
      const language = languageByExtension[extname(path).toLowerCase()];
      const uri = pathToFileURL(file).href;
      const document = documents.get(uri);
      if (!language || document?.text === undefined) {
        throw new Error(`Read ${path} before renaming a symbol in it`);
      }

      const active = clients.find((client) => client.language === language);
      if (!active?.capabilities.renameProvider) {
        throw new Error(`${commands[language].name} does not support rename`);
      }

      const position = {
        line: params.line - 1,
        character: params.column - 1,
      };
      const prepared = await active.connection.sendRequest<PrepareRenameResult | null>(
        "textDocument/prepareRename",
        { textDocument: { uri }, position },
      );

      if (prepared === null) {
        throw new Error(`${active.name} cannot rename the symbol at this position`);
      }

      const range = "start" in prepared
        ? prepared
        : "range" in prepared
        ? prepared.range
        : undefined;
      const symbol = range === undefined
        ? undefined
        : TextDocument.create(
          uri,
          language,
          document.version,
          document.text,
        ).getText(range);

      const workspaceEdit = await active.connection.sendRequest<WorkspaceEdit | null>(
        "textDocument/rename",
        {
          textDocument: { uri },
          position,
          newName: params.newName,
        },
      );
      signal?.throwIfAborted();
      if (!workspaceEdit) {
        throw new Error(`${active.name} returned no rename edits`);
      }

      const changes: Array<[string, TextEdit[]]> = [];
      if (workspaceEdit.documentChanges !== undefined) {
        for (const change of workspaceEdit.documentChanges as TextDocumentEdit[]) {
          changes.push([change.textDocument.uri, change.edits as TextEdit[]]);
        }
      } else {
        for (const editUri in workspaceEdit.changes) {
          changes.push([editUri, workspaceEdit.changes[editUri] ?? []]);
        }
      }

      const approvalResult = await approval(
        ctx,
        ctx.ui.theme.fg("accent", ctx.ui.theme.bold("Approve rename?")),
        `  ${symbol ?? "symbol"} \u2192 ${params.newName}\n  ${changes.length} file${changes.length === 1 ? "" : "s"} will change`,
        "rename_symbol was denied by the user",
      );
      if (!approvalResult.approved) {
        throw new Error(approvalResult.reason);
      }

      let editCount = 0;
      const diffs: string[] = [];
      for (const [editUri, edits] of changes) {
        const editFile = fileURLToPath(editUri);
        if (!isWithinDirectory(editFile, ctx.cwd)) {
          throw new Error(`Rename edit is outside of ${ctx.cwd}`);
        }
        await withFileMutationQueue(editFile, async () => {
          signal?.throwIfAborted();
          const text = await readFile(editFile, "utf8");
          const textDocument = TextDocument.create(editUri, "", 0, text);
          const updated = TextDocument.applyEdits(textDocument, edits);
          const diff = generateDiffString(text, updated).diff;
          diffs.push(`${relative(ctx.cwd, editFile)}\n${diff}`);
          await writeFile(editFile, updated);
        });
        editCount += edits.length;
      }

      return {
        content: [{
          type: "text",
          text: `Renamed symbol to ${params.newName} with ${editCount} edits.`,
        }],
        details: { diff: diffs.join("\n"), editCount, fileCount: changes.length, symbol },
      };
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial || result.details === undefined) {
        return new Container();
      }
      const details = result.details as {
        diff: string;
        fileCount: number;
        symbol?: string;
      };
      const rename = `${details.symbol ?? "symbol"} \u2192 ${context.args.newName}`;
      const expandHint = options.expanded
        ? ""
        : ` (${keyHint("app.tools.expand", "to expand")})`;
      const files = `${details.fileCount} file${details.fileCount === 1 ? "" : "s"} changed${expandHint}`;
      const diff = options.expanded ? `\n\n${renderDiff(details.diff)}` : "";
      return new Text(
        `${theme.fg("accent", rename)}\n${theme.fg("muted", files)}${diff}`,
        0,
        0,
      );
    },
  });

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

  pi.registerEntryRenderer<DiagnosticDetails>(
    "lsp-diagnostics",
    (entry, options, theme) => {
      if (!entry.data) {
        return new Text("", 1, 0);
      }
      const details = entry.data;
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
    description: "Request a fresh LSP diagnostic publication for a file and show all errors when it arrives.",
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
      const text = await readFile(file, "utf8");
      const document = getDocumentState(uri);

      if (
        document.text === text &&
        document.diagnostics.version === document.version
      ) {
        const serverName = commands[language].name;
        const errors = document.diagnostics.items.filter(
          (diagnostic) => diagnostic.severity === DiagnosticSeverity.Error,
        );
        const diagnostics = errors.map(
          (diagnostic) => formatDiagnostic(path, diagnostic),
        ).join("\n");
        const content = errors.length === 0
          ? `No ${serverName} errors for ${path}.`
          : `${serverName} diagnostics for ${path}:\n${diagnostics}`;

        return {
          content: [{ type: "text", text: content }],
          details: {
            serverName,
            file: path,
            count: errors.length,
            diagnostics,
            remaining: 0,
          } satisfies DiagnosticDetails,
        };
      }

      showAllRequests.add(uri);
      await syncFile(language, uri, text, document, ctx.cwd, ctx);

      return {
        content: [{
          type: "text",
          text: `Requested diagnostics for ${path}.`,
        }],
        details: { path, version: document.version },
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("accent", diagnosticsToolName)}\n${theme.fg("muted", args.path)}`,
        0,
        0,
      );
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
    if (!isReadToolResult(event) || event.isError) {
      return undefined;
    }

    const input = event.input as ReadToolInput;
    const path = input.path.replace(/^@/, "");
    const file = resolve(ctx.cwd, path);
    const language = languageByExtension[extname(path).toLowerCase()];
    if (!language) {
      return undefined;
    }

    if (!isWithinDirectory(file, ctx.cwd)) {
      ctx.ui.notify(`Not starting lsp, file ${file} is outside of the current working directory`, "info");
      return undefined;
    }

    try {
      const uri = pathToFileURL(file).href;
      const text = await readFile(file, "utf8");
      const document = getDocumentState(uri);
      if (document.text !== text) {
        await syncFile(language, uri, text, document, ctx.cwd, ctx);
      }

      if (document.diagnostics.version !== document.version) {
        return {
          content: [
            ...event.content,
            {
              type: "text",
              text: `LSP diagnostics for ${path} are pending; any errors will be returned separately when available.`,
            },
          ],
        };
      }

      const errors = document.diagnostics.items.filter(
        (diagnostic) => diagnostic.severity === DiagnosticSeverity.Error,
      );
      if (errors.length === 0) {
        return undefined;
      }

      const shown = errors.slice(0, automaticDiagnosticLimit);
      const diagnostics = shown.map(
        (diagnostic) => formatDiagnostic(path, diagnostic),
      ).join("\n");
      const remaining = errors.length - shown.length;
      const suffix = remaining > 0
        ? `\n${remaining} more diagnostics are available. Call ${diagnosticsToolName} to retrieve them.`
        : "";
      pi.appendEntry("lsp-diagnostics", {
        serverName: commands[language].name,
        file: path,
        count: errors.length,
        diagnostics,
        remaining,
      } satisfies DiagnosticDetails);
      return {
        content: [
          ...event.content,
          {
            type: "text",
            text: `${commands[language].name} diagnostics for ${path}:\n${diagnostics}${suffix}`,
          },
        ],
      };
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error ? error.message : String(error),
        "warning",
      );
      return undefined;
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || !["edit", "write"].includes(event.toolName)) {
      return undefined;
    }

    const input = event.input as EditToolInput | WriteToolInput;
    const path = input.path.replace(/^@/, "");
    const file = resolve(ctx.cwd, path);
    const language = languageByExtension[extname(path).toLowerCase()];
    if (!language) {
      return undefined;
    }

    if (!isWithinDirectory(file, ctx.cwd)) {
      ctx.ui.notify(`Not starting lsp, file ${file} is outside of the current working directory`, "info");
      return undefined;
    }

    try {
      const uri = pathToFileURL(file).href;
      const text = await readFile(file, "utf8");
      const document = getDocumentState(uri);
      if (document.text !== text) {
        await syncFile(language, uri, text, document, ctx.cwd, ctx);
      }
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error ? error.message : String(error),
        "warning",
      );
    }
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
    uri: string,
    text: string,
    document: DocumentState,
    workspace: string,
    ctx: ExtensionContext,
  ) {
    const active = await ensureClient(language, workspace, ctx);
    const isOpen = document.version > 0;
    document.version += 1;
    document.text = text;

    if (!isOpen) {
      active.connection.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: language,
          version: document.version,
          text,
        },
      });
      return;
    }

    active.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: document.version },
      contentChanges: [{ text }],
    });
  }

  function publishDiagnostics(
    serverName: string,
    params: PublishDiagnosticsParams,
  ) {
    if (
      params.version !== undefined &&
      documents.get(params.uri)?.version !== params.version
    ) {
      return;
    }

    const document = documents.get(params.uri);
    if (document) {
      document.diagnostics = {
        version: params.version,
        items: params.diagnostics,
      };
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
    const diagnostics = shown.map(
      (diagnostic) => formatDiagnostic(file, diagnostic),
    ).join("\n");
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

  function getDocumentState(uri: string): DocumentState {
    const document = documents.get(uri) ?? {
      version: 0,
      diagnostics: { version: undefined, items: [] },
    };
    documents.set(uri, document);
    return document;
  }
}


function isWithinDirectory(file: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(file));
  return relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath));
}

function formatDiagnostic(file: string, diagnostic: Diagnostic): string {
  const line = diagnostic.range.start.line + 1;
  const column = diagnostic.range.start.character + 1;
  const severity = diagnostic.severity === DiagnosticSeverity.Error
    ? "error"
    : "diagnostic";
  const isTypeScript = diagnostic.source === "ts" ||
    diagnostic.source === "typescript";
  const code = diagnostic.code === undefined
    ? ""
    : isTypeScript
    ? ` TS${diagnostic.code}`
    : ` ${diagnostic.code}`;
  const source = diagnostic.source && !isTypeScript
    ? ` [${diagnostic.source}]`
    : "";
  return `${file}:${line}:${column}: ${severity}${code}: ${diagnostic.message}${source}`;
}
