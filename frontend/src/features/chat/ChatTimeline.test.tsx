import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../components/ui/Tooltip";
import { LocaleProvider } from "../../lib/i18n";
import { ChatTimeline } from "./ChatTimeline";

describe("ChatTimeline turn ordering", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the compact welcome state for an empty new session", () => {
    render(
      <LocaleProvider>
        <ChatTimeline messages={[]} running={false} welcome />
      </LocaleProvider>,
    );

    expect(screen.getByText("Hi, what can I help you with?")).toBeTruthy();
    expect(screen.queryByText("Start a task")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
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

  it("jumps to the latest message when send requests it", async () => {
    const { container, rerender } = render(
      <LocaleProvider>
        <ChatTimeline
          messages={[{ id: "msg-1", role: "user", content: "first" }]}
          running={false}
          scrollToLatestTrigger={0}
        />
      </LocaleProvider>,
    );
    const scrollBox = container.querySelector(".conversation-wrap");
    if (!(scrollBox instanceof HTMLElement))
      throw new Error("missing timeline");
    Object.defineProperties(scrollBox, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, value: 100 },
    });
    fireEvent.scroll(scrollBox);
    vi.mocked(HTMLElement.prototype.scrollTo).mockClear();

    rerender(
      <LocaleProvider>
        <ChatTimeline
          messages={[
            { id: "msg-1", role: "user", content: "first" },
            { id: "msg-2", role: "user", content: "second" },
          ]}
          running={false}
          scrollToLatestTrigger={1}
        />
      </LocaleProvider>,
    );

    await waitFor(() =>
      expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledWith({
        top: 1000,
        behavior: "auto",
      }),
    );
  });

  it("shows Runtime run failures in the conversation", () => {
    render(
      <LocaleProvider>
        <ChatTimeline
          flowTurns={[{ flowStart: 0, turnId: "msg-1", runId: "run-1" }]}
          messages={[{ id: "msg-1", role: "user", content: "用 5.2 试一下" }]}
          run={{
            run_id: "run-1",
            state: "failed",
            can_control: false,
            error: {
              kind: "http",
              message:
                "All available accounts are currently rate-limited. Please retry later.",
              status_code: 429,
              model: "gpt-5.2",
            },
          }}
          running={false}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText("Model request failed")).toBeTruthy();
    expect(
      screen.getByText(
        /HTTP 429: All available accounts are currently rate-limited/,
      ),
    ).toBeTruthy();
  });

  it("highlights an active skill in blue", () => {
    render(
      <LocaleProvider>
        <ChatTimeline
          flow={[
            {
              kind: "skill",
              item: { name: "agent-browser", status: "loading" },
            },
          ]}
          messages={[]}
          running
        />
      </LocaleProvider>,
    );

    const skill = screen.getByText("Skill agent-browser");
    expect(skill.classList.contains("text-blue-strong")).toBe(true);
    expect(skill.closest("article")?.classList.contains("bg-blue/8")).toBe(
      true,
    );
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

  it("offers selected text as composer context", async () => {
    const onQuoteSelection = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <LocaleProvider>
        <ChatTimeline
          messages={[{ id: "msg-1", role: "assistant", content: "select me" }]}
          onQuoteSelection={onQuoteSelection}
          running={false}
        />
      </LocaleProvider>,
    );

    const textNode = screen.getByText("select me").firstChild;
    vi.spyOn(window, "getSelection").mockReturnValue({
      anchorNode: textNode,
      focusNode: textNode,
      isCollapsed: false,
      rangeCount: 1,
      removeAllRanges: vi.fn(),
      getRangeAt: () => ({
        getBoundingClientRect: () =>
          ({ left: 100, top: 100, width: 80 }) as DOMRect,
      }),
      toString: () => "select me",
    } as unknown as Selection);

    fireEvent.mouseUp(screen.getByText("select me"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("select me"));
    fireEvent.click(
      screen.getByRole("button", { name: /add to conversation/i }),
    );

    expect(onQuoteSelection).toHaveBeenCalledWith("select me");
  });

  it("copies selected text after selection ends", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <LocaleProvider>
        <ChatTimeline
          messages={[{ id: "msg-1", role: "assistant", content: "copy me" }]}
          running={false}
        />
      </LocaleProvider>,
    );

    const textNode = screen.getByText("copy me").firstChild;
    vi.spyOn(window, "getSelection").mockReturnValue({
      anchorNode: textNode,
      focusNode: textNode,
      isCollapsed: false,
      rangeCount: 1,
      removeAllRanges: vi.fn(),
      getRangeAt: () => ({
        getBoundingClientRect: () =>
          ({ left: 100, top: 100, width: 80 }) as DOMRect,
      }),
      toString: () => "copy me",
    } as unknown as Selection);

    fireEvent.mouseUp(screen.getByText("copy me"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("copy me"));
    expect(await screen.findByText("Copied")).toBeTruthy();
  });
});
