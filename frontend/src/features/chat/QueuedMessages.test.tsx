import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import { TooltipProvider } from "../../components/ui/Tooltip";
import { QueuedMessages } from "./QueuedMessages";
import type { QueuedMessage } from "../runtime/sessionState";

describe("QueuedMessages", () => {
  it("places redirect beside each queued message", () => {
    const onInterrupt = vi.fn();
    const item: QueuedMessage = {
      id: "steer-1",
      content: "change direction",
      parts: [{ type: "text", text: "change direction" }],
    };
    render(
      <TooltipProvider>
        <LocaleProvider>
          <QueuedMessages
            items={[item]}
            onInterrupt={onInterrupt}
            onRemove={vi.fn()}
          />
        </LocaleProvider>
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /change direction/i }));
    expect(onInterrupt).toHaveBeenCalledWith(item);
  });
});
