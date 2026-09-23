import type {
  TrustedExtensionUiRequest,
  TrustedExtensionUiResponse,
} from "@pi-desktop/shared";

/** Keeps catalog probes inert while returning a valid response for every UI request. */
export function catalogProbeUiResponse(
  request: TrustedExtensionUiRequest,
): TrustedExtensionUiResponse {
  switch (request.kind) {
    case "cancel":
      return { kind: "cancel" };
    case "confirm":
      return { kind: "confirm", value: false };
    case "select":
      return { kind: "select", value: undefined };
    case "input":
      return { kind: "input", value: undefined };
    case "notify":
      return { kind: "notify" };
    case "setStatus":
      return { kind: "setStatus" };
    case "setWorkingMessage":
      return { kind: "setWorkingMessage" };
  }
}
