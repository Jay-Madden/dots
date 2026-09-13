import { keyHint, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";

const COMPACT_LINE_COUNT = 3;
const VERTICAL_BAR = "\u2502";

export default function (pi: ExtensionAPI) {
  let extended = false;
  let theme: Theme;

  pi.registerMarkdownTransformer((markdown, { messageType }) => {
    if (messageType !== "assistant-thinking") {
      return markdown;
    }

    const lines = markdown.split("\n").filter((line) => line.trim() !== "");
    const isCollapsed = !extended && lines.length > COMPACT_LINE_COUNT;
    const content = isCollapsed ? lines.slice(-COMPACT_LINE_COUNT) : lines;
    const rendered = content.map((line) => theme.fg("muted", `${VERTICAL_BAR} ${line}`));

    if (isCollapsed) {
      rendered.push(
        theme.fg("muted", `${VERTICAL_BAR} ${keyHint("app.tools.expand", "to expand")}`),
      );
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

}


