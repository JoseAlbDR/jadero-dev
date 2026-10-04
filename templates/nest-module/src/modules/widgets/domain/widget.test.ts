import { describe, expect, it } from "vitest";
import { WidgetNameInvalid } from "./widget.errors.js";
import { Widget } from "./widget.js";

describe("Widget", () => {
  it("trims the name on create and rename", () => {
    const widget = Widget.create("w-1", "  lamp ");
    expect(widget.name).toBe("lamp");
    widget.rename(" desk lamp ");
    expect(widget.name).toBe("desk lamp");
  });

  it.each(["", "   ", "x".repeat(61)])("rejects the name %j", (name) => {
    expect(() => Widget.create("w-1", name)).toThrow(WidgetNameInvalid);
  });
});
