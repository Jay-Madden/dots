import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const currentContext = await getCurrentKubeContext();

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number) {
          let input = 0;
          let output = 0;
          let cacheRead = 0;
          let cacheWrite = 0;
          let latestCacheHitRate: number | undefined;

          for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.type !== "message" || entry.message.role !== "assistant") {
              continue;
            }
            const usage = entry.message.usage;
            input += usage.input;
            output += usage.output;
            cacheRead += usage.cacheRead;
            cacheWrite += usage.cacheWrite;
            const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
            if (promptTokens > 0) {
              latestCacheHitRate = usage.cacheRead / promptTokens * 100;
            }
          }

          const branch = footerData.getGitBranch();
          const basePath = branch ? `${ctx.cwd} (${branch})` : ctx.cwd;
          const path = currentContext
            ? `${basePath} | ☸ ${currentContext}`
            : basePath;
          const usage = ctx.getContextUsage();
          const context = usage?.percent === null
            ? `?/${formatTokens(usage.contextWindow)}`
            : `${(usage?.percent ?? 0).toFixed(1)}%/${formatTokens(usage?.contextWindow ?? ctx.model?.contextWindow ?? 0)}`;
          const stats = [
            input > 0 ? `↑${formatTokens(input)}` : undefined,
            output > 0 ? `↓${formatTokens(output)}` : undefined,
            cacheRead > 0 ? `R${formatTokens(cacheRead)}` : undefined,
            cacheWrite > 0 ? `W${formatTokens(cacheWrite)}` : undefined,
            latestCacheHitRate !== undefined ? `CH${latestCacheHitRate.toFixed(1)}%` : undefined,
            `${context} (auto)`,
            ...footerData.getExtensionStatuses().values(),
          ].filter((value): value is string => Boolean(value));

          const left = theme.fg("dim", stats.join(" "));
          const thinking = pi.getThinkingLevel();
          const right = theme.fg("dim", `${ctx.model?.id ?? "no-model"} | ${thinking}`);
          const padding = " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(right)));

          return [
            truncateToWidth(theme.fg("dim", path), width),
            truncateToWidth(left + padding + right, width),
          ];
        },
      };
    });
  });
}

async function getCurrentKubeContext(): Promise<string | undefined> {
  const path = process.env.KUBECONFIG || join(homedir(), ".kube", "config");

  try {
    const config = parse(await readFile(path, "utf8")) as {
      "current-context"?: string;
    };
    return config["current-context"];
  } catch {
    return undefined;
  }
}

function formatTokens(count: number): string {
  if (count < 1000) {
    return String(count);
  }
  if (count < 10000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  if (count < 1000000) {
    return `${Math.round(count / 1000)}k`;
  }
  return `${(count / 1000000).toFixed(1)}M`;
}
