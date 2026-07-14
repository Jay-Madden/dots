import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const provider = process.env.PI_DEFAULT_PROVIDER;
    const modelId = process.env.PI_DEFAULT_MODEL;
    if (!provider || !modelId) {
      return;
    }

    const model = ctx.modelRegistry.find(provider, modelId);
    if (!model) {
      ctx.ui.notify(`Default model not found: ${provider}/${modelId}`, "warning");
      return;
    }

    if (!(await pi.setModel(model))) {
      ctx.ui.notify(`No API key for ${provider}/${modelId}`, "warning");
    }
  });
}
