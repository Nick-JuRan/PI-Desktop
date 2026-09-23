import { describe, expect, it } from "vitest";
import { catalogProbeUiResponse } from "./catalog-probe-ui.js";

describe("catalog probe UI responses", () => {
  it("acknowledges cancellation without opening a prompt", () => {
    expect(
      catalogProbeUiResponse({ kind: "cancel", requestId: "probe-request" }),
    ).toEqual({ kind: "cancel" });
  });

  it("keeps interactive requests inert during catalog discovery", () => {
    expect(
      catalogProbeUiResponse({ kind: "confirm", title: "Confirm?", message: "Continue?" }),
    ).toEqual({ kind: "confirm", value: false });
  });
});
