import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../components/ui/Tooltip";
import { LocaleProvider } from "../../lib/i18n";
import { ChatTimeline } from "./ChatTimeline";

describe("ChatTimeline turn ordering", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it("renders each response directly after its applied user message", () => {
    render(
      <LocaleProvider>
        <ChatTimeline
          flow={[
            { kind: "assistant", id: 1, text: "answer one", done: true },
            { kind: "assistant", id: 2, text: "answer two", done: true },
            { kind: "assistant", id: 3, text: "answer three", done: true },
          ]}
          flowTurns={[
            { flowStart: 0, turnId: "one" },
            { flowStart: 1, turnId: "two" },
            { flowStart: 2, turnId: "three" },
          ]}
          messages={[
            { id: "one", role: "user", content: "message one" },
            { id: "two", role: "user", content: "message two" },
            { id: "three", role: "user", content: "message three" },
          ]}
          running={false}
        />
      </LocaleProvider>,
    );

    const ordered = [
      screen.getByText("message one"),
      screen.getByText("answer one"),
      screen.getByText("message two"),
      screen.getByText("answer two"),
      screen.getByText("message three"),
      screen.getByText("answer three"),
    ];
    for (let index = 1; index < ordered.length; index++) {
      expect(
        ordered[index - 1]!.compareDocumentPosition(ordered[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
    }
  });

  it("does not show an in-flight user message as queued", () => {
    render(
      <TooltipProvider>
        <LocaleProvider>
          <ChatTimeline
            messages={[{ id: "msg-1", role: "user", content: "你好" }]}
            onInterruptQueuedMessage={vi.fn()}
            onRemoveQueuedMessage={vi.fn()}
            queuedMessages={[
              {
                id: "msg-1",
                content: "你好",
                parts: [{ type: "text", text: "你好" }],
              },
              {
                id: "msg-2",
                content: "下一条",
                parts: [{ type: "text", text: "下一条" }],
              },
            ]}
            running={false}
          />
        </LocaleProvider>
      </TooltipProvider>,
    );

    expect(screen.getByText("Queued messages")).toBeTruthy();
    expect(screen.getByText("下一条")).toBeTruthy();
    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.getAllByText("你好")).toHaveLength(1);
  });

  it("keeps snapshot tool activity collapsed until opened", () => {
    render(
      <LocaleProvider>
        <ChatTimeline
          messages={[]}
          running={false}
          toolSummary={{
            total: 37,
            success: 36,
            failed: 1,
            recent: [
              {
                tool: "http",
                status: "success",
                summary: "Status: 200 200 OK | Headers:",
              },
            ],
          }}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText("Tool activity")).toBeTruthy();
    expect(screen.queryByText("Status: 200 200 OK | Headers:")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /tool activity/i }));
    expect(screen.getByText("Status: 200 200 OK | Headers:")).toBeTruthy();
  });
});
