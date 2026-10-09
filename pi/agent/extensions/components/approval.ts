import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Input,
  Key,
  matchesKey,
  type KeyId,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export type Approval = { approved: true } | { approved: false; reason: string };

export type ApprovalOption = {
  display: string;
  onSelect: () => Approval | undefined | Promise<Approval | undefined>;
  feedback?: boolean;
};

export type ApprovalShortcut = {
  key: KeyId;
  display: string;
  onSelect: ApprovalOption["onSelect"];
};

export const YES_OPTION: ApprovalOption = {
  display: "Yes",
  onSelect: () => ({ approved: true }),
};

export const NO_OPTION: ApprovalOption = {
  display: "No",
  onSelect: () => ({ approved: false, reason: "Denied by the user" }),
  feedback: true,
};

export async function approval(
  ctx: ExtensionContext,
  title: string,
  message: string,
  defaultReason: string,
  shortcuts: ApprovalShortcut[] = [],
  options: ApprovalOption[] = [
    YES_OPTION,
    NO_OPTION,
  ],
): Promise<Approval> {
  if (options.length === 0) {
    return { approved: false, reason: defaultReason };
  }

  if (ctx.mode !== "tui") {
    while (true) {
      const selected = await ctx.ui.select(`${title}\n${message}`, options.map((option) => option.display));
      const option = options.find((option) => option.display === selected);
      if (!option) {
        return { approved: false, reason: defaultReason };
      }
      try {
        const result = await option.onSelect();
        if (result) {
          return result;
        }
      } catch (error: unknown) {
        return {
          approved: false,
          reason: error instanceof Error ? error.message : defaultReason,
        };
      }
    }
  }

  // Send a Zellij notification when an approval needs attention.
  if (process.env.ZELLIJ !== undefined) {
    process.stdout.write("\x07");
  }

  return ctx.ui.custom<Approval>((tui, theme, keybindings, done) => {
    let selected = 0;
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

    const select = async (option: ApprovalOption) => {
      try {
        const result = await option.onSelect();
        if (result) {
          done(result);
        } else {
          tui.requestRender();
        }
      } catch (error: unknown) {
        done({
          approved: false,
          reason: error instanceof Error ? error.message : defaultReason,
        });
      }
    };

    return {
      handleInput(data: string) {
        if (matchesKey(data, Key.ctrl("c"))) {
          let timeout: ReturnType<typeof setTimeout>;
          const removeListener = tui.addInputListener((nextData) => {
            if (!matchesKey(nextData, Key.ctrl("c"))) {
              return;
            }

            clearTimeout(timeout);
            removeListener();
            // Cancel the in progress model request so we shutdown immediately
            ctx.abort();
            ctx.shutdown();
            return { consume: true };
          });
          timeout = setTimeout(removeListener, 500);

          done({ approved: false, reason: defaultReason });
          return;
        }

        if (keybindings.matches(data, "app.tools.expand")) {
          ctx.ui.setToolsExpanded(!ctx.ui.getToolsExpanded());
          tui.requestRender();
          return;
        }

        if (feedbackMode) {
          if (matchesKey(data, Key.up)) {
            feedbackMode = false;
            selected = 0;
            input.setValue("");
          } else {
            input.handleInput(data);
          }
          tui.requestRender();
          return;
        }

        const shortcut = shortcuts.find((item) => matchesKey(data, item.key));
        if (shortcut) {
          void select(shortcut);
          return;
        }

        if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) {
          selected = Math.max(0, selected - 1);
        } else if (matchesKey(data, Key.right) || matchesKey(data, Key.down)) {
          selected = Math.min(options.length - 1, selected + 1);
        } else if (matchesKey(data, Key.tab) && options[selected]?.feedback) {
          feedbackMode = true;
        } else if (matchesKey(data, Key.enter)) {
          const option = options[selected];
          if (option) {
            void select(option);
          }
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
        for (const [index, option] of options.entries()) {
          let line = selected === index
            ? theme.fg("accent", `${selectedPrefix}${option.display}`)
            : `${padding}${option.display}`;

          if (feedbackMode && selected === index) {
            const inputLines = input.render(Math.max(1, innerWidth - 5));
            const feedback = input.getValue()
              ? (inputLines[0] ?? "").slice(2)
              : "What should I do differently?";
            line += ` ${theme.fg("dim", feedback)}`;
          }
          lines.push(line);
        }

        lines.push("");
        const controls = [
          ` ${theme.fg("dim", "\u2191\u2193")} ${theme.fg("muted", "navigate")}`,
          `  ${theme.fg("dim", "enter")} ${theme.fg("muted", "select")}`,
          `  ${theme.fg("dim", "escape/ctrl+c")} ${theme.fg("muted", "cancel")}`,
          ...shortcuts.map(
            (item) => `  ${theme.fg("dim", item.key)} ${theme.fg("muted", item.display)}`,
          ),
        ];
        lines.push(
          feedbackMode
            ? theme.fg("dim", " Enter reject with message  escape back")
            : controls.join(""),
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
