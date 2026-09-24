import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSegmentedControlItemAttributes } from "../src/components/segmented-control-attributes.ts";

describe("getSegmentedControlItemAttributes", () => {
  it("exposes selection state according to the container role", () => {
    assert.deepEqual(
      getSegmentedControlItemAttributes("group", "Sort", "recent", { value: "recent" }),
      { "aria-pressed": true },
    );
    assert.deepEqual(
      getSegmentedControlItemAttributes("radiogroup", "Mode", "plan", { value: "agent" }),
      { role: "radio", "aria-checked": false },
    );
    assert.deepEqual(
      getSegmentedControlItemAttributes("tablist", "Import", "skills", {
        value: "skills",
        id: "import-tab-skills",
        controls: "import-panel-skills",
      }),
      {
        role: "tab",
        id: "import-tab-skills",
        "aria-selected": true,
        "aria-controls": "import-panel-skills",
      },
    );
  });

  it("keeps generated tab ids when explicit ids are omitted", () => {
    assert.deepEqual(
      getSegmentedControlItemAttributes("tablist", "Remote hosts", "pair", { value: "pair" }),
      {
        role: "tab",
        id: "Remote hosts-tab-pair",
        "aria-selected": true,
      },
    );
  });
});
