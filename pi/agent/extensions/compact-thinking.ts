import { keyHint, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";

const COMPACT_LINE_COUNT = 3;
const VERTICAL_BAR = "\u2502";

export default function (pi: ExtensionAPI) {
  let extended = false;
  let theme: Theme;
  const completedThinkingDurations = new Map<string, number>();
  let currentThinking = "";
  let currentTimer: number | undefined;
  let elapsedTimer: ReturnType<typeof setInterval> | undefined;

  pi.registerMarkdownTransformer((markdown, { messageType }) => {
    if (messageType !== "assistant-thinking") {
      return markdown;
    }

    const lines = markdown.split("\n").filter((line) => line.trim() !== "");
    const isCollapsed = !extended && lines.length > COMPACT_LINE_COUNT;
    const content = isCollapsed ? lines.slice(-COMPACT_LINE_COUNT) : lines;
    const rendered = content.map((line) => theme.fg("muted", `${VERTICAL_BAR} ${line}`));

    const thinking = markdown.trim();
    let elapsedMs = completedThinkingDurations.get(thinking);
    if (thinking === currentThinking.trim() && currentTimer !== undefined) {
      elapsedMs = Date.now() - currentTimer;
    }

    let elapsed = "";
    if (elapsedMs !== undefined && elapsedMs > 0) {
      elapsed = `${(elapsedMs / 1000).toFixed(1)}s `;
    }
    if (isCollapsed) {
      rendered.push(
        theme.fg("muted", `${VERTICAL_BAR} ${elapsed}${keyHint("app.tools.expand", "to expand")}`),
      );
    } else if (elapsed) {
      rendered.push(theme.fg("muted", `${VERTICAL_BAR} ${elapsed.trimEnd()}`));
    }

    return rendered.join("\n");
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
      currentThinking = "";
      currentTimer = Date.now();
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
      currentThinking += event.assistantMessageEvent.delta.trim();
      return;
    }

    if (event.assistantMessageEvent.type === "thinking_end") {
      if (currentTimer !== undefined) {
        const thinking = currentThinking.trim() || event.assistantMessageEvent.content.trim();
        completedThinkingDurations.set(thinking, Date.now() - currentTimer);
      }
      currentThinking = "";
      currentTimer = undefined;
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
    currentThinking = "";
    currentTimer = undefined;
    if (elapsedTimer !== undefined) {
      clearInterval(elapsedTimer);
      elapsedTimer = undefined;
    }
  });

  pi.on("session_shutdown", () => {
    currentThinking = "";
    currentTimer = undefined;
    if (elapsedTimer !== undefined) {
      clearInterval(elapsedTimer);
      elapsedTimer = undefined;
    }
  });
}


