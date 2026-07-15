import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export type Approval = { approved: true } | { approved: false; reason: string };

export async function approval(
  ctx: ExtensionContext,
  title: string,
  message: string,
  defaultReason: string,
): Promise<Approval> {
  if (ctx.mode !== "tui") {
    const approved = await ctx.ui.confirm(title, message);
    return approved
      ? { approved: true }
      : { approved: false, reason: defaultReason };
  }

  return ctx.ui.custom<Approval>((tui, theme, keybindings, done) => {
    let selected: "yes" | "no" = "yes";
    let feedbackMode = false;
    const input = new Input();

    input.onSubmit = (value) => {
      const reason = value.trim();
      done({ approved: false, reason: reason || defaultReason });
    };

    input.onEscape = () => {
      feedbackMode = false;
      input.setValue("");
      tui.requestRender();
    };

    return {
      handleInput(data: string) {
        if (keybindings.matches(data, "app.tools.expand")) {
          ctx.ui.setToolsExpanded(!ctx.ui.getToolsExpanded());
          tui.requestRender();
          return;
        }

        if (feedbackMode) {
          if (matchesKey(data, Key.up)) {
            feedbackMode = false;
            selected = "yes";
            input.setValue("");
          } else {
            input.handleInput(data);
          }
          tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) {
          selected = "yes";
        } else if (matchesKey(data, Key.right) || matchesKey(data, Key.down)) {
          selected = "no";
        } else if (matchesKey(data, Key.tab) && selected === "no") {
          feedbackMode = true;
        } else if (matchesKey(data, Key.enter)) {
          done(
            selected === "yes"
              ? { approved: true }
              : { approved: false, reason: defaultReason },
          );
          return;
        } else if (matchesKey(data, Key.escape)) {
          done({ approved: false, reason: defaultReason });
          return;
        }
        tui.requestRender();
      },
      render(width: number) {
        const innerWidth = Math.max(1, width - 2);
        const lines = [theme.fg("border", "─".repeat(width)), ""];
        lines.push(` ${title}`);
        for (const sourceLine of message.split("\n")) {
          lines.push(...wrapTextWithAnsi(` ${sourceLine}`, innerWidth));
        }
        lines.push("");

        const padding = "   ";
        // this emote →
        const selectedPrefix = " \u2192 ";
        lines.push(
          selected === "yes"
            ? theme.fg("accent", `${selectedPrefix}Yes`)
            : `${padding}Yes`,
        );
        lines.push(
          selected === "no"
            ? theme.fg("accent", `${selectedPrefix}No`)
            : `${padding}No`,
        );

        if (feedbackMode) {
          const inputLines = input.render(Math.max(1, innerWidth - 5));
          const feedback = input.getValue()
            ? (inputLines[0] ?? "").slice(2)
            : "What should I do differently?";
          lines[lines.length - 1] =
            `${lines[lines.length - 1]} ${theme.fg("dim", feedback)}`;
        }

        lines.push("");
        lines.push(
          feedbackMode
            ? theme.fg("dim", " Enter reject with message  escape back")
            : ` ${theme.fg("dim", "\u2191\u2193")} ${theme.fg("muted", "navigate")}  ${theme.fg("dim", "enter")} ${theme.fg("muted", "select")} ${theme.fg("dim", "escape/ctrl+c")} ${theme.fg("muted", "cancel")}`,
        );
        lines.push("");
        lines.push(theme.fg("border", "─".repeat(width)));

        return lines.map((line) => truncateToWidth(line, width));
      },
      invalidate() {
        input.invalidate();
      },
    };
  });
}
