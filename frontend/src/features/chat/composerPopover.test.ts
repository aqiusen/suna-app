import { describe, expect, it } from "vitest";
import { composerPopoverPlacement } from "./composerPopover";

describe("composerPopoverPlacement", () => {
  it("keeps a slash menu inside the visible area above the composer", () => {
    expect(
      composerPopoverPlacement({ top: 650, bottom: 760 }, 980, 320),
    ).toEqual({ placement: "above", maxHeight: 320 });
  });

  it("opens below the composer when the upper area is smaller", () => {
    expect(
      composerPopoverPlacement({ top: 120, bottom: 230 }, 980, 420),
    ).toEqual({ placement: "below", maxHeight: 420 });
  });

  it("limits the panel to the remaining space", () => {
    expect(
      composerPopoverPlacement({ top: 280, bottom: 390 }, 500, 320),
    ).toEqual({ placement: "above", maxHeight: 260 });
  });
});
