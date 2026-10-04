import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  keyHint,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const providerId = "exa";
const defaultBaseUrl = "https://api.exa.ai";

interface WebSearchDetails {
  provider: string;
  query: string;
  resultCount: number;
  truncated: boolean;
}

interface SearchResult {
  title?: string;
  url: string;
  text?: string;
  publishedDate?: string;
}

interface SearchResponse {
  results?: SearchResult[];
  error?: string | { message?: string };
}

interface TruncatedOutput {
  text: string;
  truncated: boolean;
}

export default function (pi: ExtensionAPI) {
  if (!process.env.EXA_API_KEY) {
    return;
  }

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: `Research the current web through Exa. Output is limited to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Research the current web with Exa",
    promptGuidelines: [
      "Use web_search for current events, recent releases, changing documentation, or facts that require web research.",
    ],
    parameters: Type.Object({
      query: Type.String({
        minLength: 1,
        description: "Question or topic to research on the web",
      }),
      max_results: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: 20,
        description: "Maximum search results (default: 5)",
      })),
    }),
    renderCall(args, theme) {
      const text = theme.fg("toolTitle", theme.bold("web_search "))
        + theme.fg("accent", `"${args.query}"`);
      return new Text(text, 0, 0);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const auth = await ctx.modelRegistry.getProviderAuth(providerId);
      const apiKey = auth?.auth.apiKey ?? process.env.EXA_API_KEY;
      if (!apiKey) {
        throw new Error("EXA_API_KEY is not configured");
      }

      const provider = ctx.modelRegistry.getProvider(providerId);
      const baseUrl = auth?.auth.baseUrl ?? provider?.baseUrl ?? defaultBaseUrl;
      const request: RequestInit = {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: params.query,
          numResults: params.max_results ?? 5,
          contents: { text: { maxCharacters: 1000 } },
        }),
      };
      if (signal) {
        request.signal = signal;
      }

      const response = await fetch(
        `${baseUrl.replace(/\/$/, "")}/search`,
        request,
      );
      const payload = await parseSearchResponse(response);
      const results = payload.results ?? [];
      const truncated = truncateSearchResults(formatResults(results));

      return {
        content: [{ type: "text", text: truncated.text }],
        details: {
          provider: providerId,
          query: params.query,
          resultCount: results.length,
          truncated: truncated.truncated,
        } satisfies WebSearchDetails,
      };
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("muted", "Searching..."), 0, 0);
      }

      const details = result.details as WebSearchDetails | undefined;
      if (!expanded) {
        const resultCount = details?.resultCount ?? 0;
        const resultLabel = `${resultCount} result${resultCount === 1 ? "" : "s"}`;
        const truncatedLabel = details?.truncated ? " (truncated)" : "";
        const hint = keyHint("app.tools.expand", "to expand");
        return new Text(
          theme.fg("muted", `${resultLabel}${truncatedLabel} (${hint})`),
          0,
          0,
        );
      }

      const content = result.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => theme.fg("muted", block.text))
        .join("\n");
      return new Text(content, 0, 0);
    },
  });
}

async function parseSearchResponse(response: Response): Promise<SearchResponse> {
  const text = await response.text();
  let payload: SearchResponse;
  try {
    payload = JSON.parse(text) as SearchResponse;
  } catch {
    throw new Error(`Web search returned invalid JSON (HTTP ${response.status})`);
  }

  if (!response.ok || payload.error) {
    const error = typeof payload.error === "string"
      ? payload.error
      : payload.error?.message;
    throw new Error(error ?? `Exa search failed with HTTP ${response.status}`);
  }
  return payload;
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No search results found.";
  }

  return results.map((result, index) => [
    `${index + 1}. ${result.title?.trim() || result.url}`,
    `URL: ${result.url}`,
    result.publishedDate ? `Date: ${result.publishedDate}` : undefined,
    result.text?.trim(),
  ].filter((value): value is string => Boolean(value)).join("\n")).join("\n\n");
}

function truncateSearchResults(output: string): TruncatedOutput {
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (!truncation.truncated) {
    return { text: truncation.content, truncated: false };
  }

  const notice = [
    `Output truncated to ${truncation.outputLines} of ${truncation.totalLines} lines`,
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`,
  ].join(" ");
  return {
    text: `${truncation.content}\n\n[${notice}]`,
    truncated: true,
  };
}
