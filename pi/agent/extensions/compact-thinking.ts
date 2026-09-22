import { getMarkdownTheme, keyHint, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey } from "@earendil-works/pi-tui";

const COMPACT_LINE_COUNT = 3;
const VERTICAL_BAR = "\u2502";

function normalizeThinking(thinking: string): string {
  return thinking.replace(/[\r\n]+/g, "");
}

export default function (pi: ExtensionAPI) {
  let extended = false;
  let theme: Theme;
  const thinkingBlocks: Array<{
    startTime: number;
    content: string[];
    endTime: number | null;
  }> = [];
  let elapsedTimer: ReturnType<typeof setInterval> | undefined;

  pi.registerMarkdownTransformer((markdown, { messageType, availableWidth }) => {
    if (messageType !== "assistant-thinking") {
      return markdown;
    }

    const lines = markdown.split("\n").filter((line) => line.trim() !== "");

    const isCollapsed = !extended && lines.length > COMPACT_LINE_COUNT;
    const content = isCollapsed ? lines.slice(-COMPACT_LINE_COUNT) : lines;
    const markdownTheme = getMarkdownTheme();
    const rendered = content.flatMap((line) =>
      new Markdown(line, 0, 0, markdownTheme, { italic: true })
        .render(Math.max(1, availableWidth - 4))
        .map((wrappedLine, index) => `${VERTICAL_BAR} ${index === 0 ? "" : "  "}${wrappedLine.trimEnd()}`),
    );

    const contentLineCount = rendered.length;
    const thinking = normalizeThinking(lines.join(""));
    const thinkingBlock = thinkingBlocks.find((block) => {
      return block.content.join("") === thinking;
    });
    let elapsedMs: number | undefined;
    if (thinkingBlock !== undefined) {
      const endTime = thinkingBlock.endTime ?? Date.now();
      elapsedMs = endTime - thinkingBlock.startTime;
    }

    let elapsed = "";
    if (elapsedMs !== undefined && elapsedMs > 0) {
      elapsed = `${(elapsedMs / 1000).toFixed(1)}s `;
    }
    if (isCollapsed) {
      rendered.push(
        theme.fg("muted", `${VERTICAL_BAR} ${elapsed}(`)
          + keyHint("app.tools.expand", "to expand")
          + theme.fg("muted", ")"),
      );
    } else if (elapsed) {
      rendered.push(theme.fg("muted", `${VERTICAL_BAR} ${elapsed.trimEnd()}`));
    }

    return rendered.map((line, index) => {
      const fence = "`".repeat(Math.max(0, ...Array.from(line.matchAll(/`+/g), (match) => match[0].length)) + 1);
      if (index >= contentLineCount) {
        return `${fence}${line}${fence}`;
      }
      const foreground = theme.getFgAnsi("thinkingText");
      const styled = line.replace(/\x1b\[[\d;]*m/g, `$&${foreground}`);
      const framed = theme.fg("thinkingText", styled).replace(VERTICAL_BAR, theme.fg("muted", VERTICAL_BAR) + foreground);
      // Code spans keep the outer Markdown pass from recoloring the rendered text.
      return `${fence}${framed}${fence}`;
    }).join("\n");
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") {
      return;
    }

    theme = ctx.ui.theme;
    ctx.ui.onTerminalInput((data) => {
      if (!matchesKey(data, Key.ctrl("o"))) {
        return undefined;
      }
      extended = !extended;
      ctx.ui.setHiddenThinkingLabel();
      return;
    });
  });

  pi.on("message_update", (event, ctx) => {
    if (event.assistantMessageEvent.type === "thinking_start") {

      const { content } = event.assistantMessageEvent.partial;
      const { contentIndex } = event.assistantMessageEvent;

      const previousContent = content[contentIndex - 1];
      let thinkingBlock = thinkingBlocks.at(-1);

      // Pis markdown renderer will merge consecutive thinking blocks into one markdown render
      if (previousContent?.type !== "thinking" || thinkingBlock === undefined) {
        thinkingBlock = { startTime: Date.now(), content: [], endTime: null };
        thinkingBlocks.push(thinkingBlock);
      } else {
        // Make sure to reset endTime if the stream is continuing
        thinkingBlock.endTime = null;
      }

      const initialContent = content[contentIndex];
      if (initialContent?.type === "thinking") {
        const thinking = normalizeThinking(initialContent.thinking.trim());
        if (thinking) {
          thinkingBlock.content.push(thinking);
        }
      }
      if (elapsedTimer !== undefined) {
        clearInterval(elapsedTimer);
      }
      if (ctx.mode === "tui") {
        elapsedTimer = setInterval(() => {
          ctx.ui.setHiddenThinkingLabel();
        }, 100);
      }
      return;
    }

    if (event.assistantMessageEvent.type === "thinking_delta") {
      const thinkingBlock = thinkingBlocks.at(-1);
      if (thinkingBlock !== undefined) {
        const delta = normalizeThinking(event.assistantMessageEvent.delta);
        if (delta) {
          thinkingBlock.content.push(delta);
        }
      }
      return;
    }

    if (event.assistantMessageEvent.type === "thinking_end") {
      const thinkingBlock = thinkingBlocks.at(-1);
      if (thinkingBlock !== undefined) {
        if (thinkingBlock.content.join("") === "") {
          thinkingBlock.content.push(normalizeThinking(event.assistantMessageEvent.content.trim()));
        }
        thinkingBlock.endTime = Date.now();
      }
      if (elapsedTimer !== undefined) {
        clearInterval(elapsedTimer);
        elapsedTimer = undefined;
      }
      if (ctx.mode === "tui") {
        ctx.ui.setHiddenThinkingLabel();
      }
    }
  });

  pi.on("agent_end", () => {
    if (elapsedTimer !== undefined) {
      clearInterval(elapsedTimer);
      elapsedTimer = undefined;
    }
  });

  pi.on("session_shutdown", () => {
    if (elapsedTimer !== undefined) {
      clearInterval(elapsedTimer);
      elapsedTimer = undefined;
    }
  });
}


