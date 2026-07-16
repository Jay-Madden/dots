import type {
  EditToolInput,
  ExtensionAPI,
  WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { approval } from "./components/approval.ts";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") {
      return undefined;
    }

    const input = event.input as EditToolInput | WriteToolInput;
    const result = await approval(
      ctx,
      ctx.ui.theme.fg("accent", ctx.ui.theme.bold(`Approve ${event.toolName}?`)),
      ctx.ui.theme.fg("muted", input.path),
      `${event.toolName} was denied by the user`,
    );
    return result.approved
      ? undefined
      : { block: true, reason: result.reason };
  });
}
