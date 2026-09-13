import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerMarkdownTransformer((markdown, { messageType }) => {
    if (messageType !== "assistant" && messageType !== "assistant-thinking") {
      return markdown;
    }
    const lines = markdown.split("\n");
    const result: string[] = [];
    let inFence = false;

    for (const line of lines) {
      const openingFence = /^\s*(`{3,}|~{3,})/.exec(line);
      const closingFence = /^\s*(`{3,}|~{3,})\s*$/.test(line);

      if (!inFence && openingFence) {
        inFence = true;
        result.push(line);
        continue;
      }

      if (inFence) {
        result.push(line);
        if (closingFence) {
          inFence = false;
        }

        continue;
      }

      if (line.trim() !== "") {
        result.push(line);
      }
    }

    return result.join("\n");
  });
}
