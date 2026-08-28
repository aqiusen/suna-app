import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import { TooltipProvider } from "../../components/ui/Tooltip";
import { SessionSidebar } from "./SessionSidebar";
import type { SessionInfo } from "../../lib/runtimeBridge";

const session: SessionInfo = {
  id: "s1",
  title: "Demo session",
  cwd: "/tmp/demo",
  message_count: 0,
  created_at: "",
  updated_at: "",
  status: "idle",
  client_count: 0,
};

function renderSidebar(onRequestCreate = vi.fn()) {
  const onDelete = vi.fn();
  const onRename = vi.fn();
  render(
    <LocaleProvider>
      <TooltipProvider>
        <SessionSidebar
          connected
          onCreate={async () => undefined}
          onDelete={onDelete}
          onReconnect={() => undefined}
          onRename={onRename}
          onRequestCreate={onRequestCreate}
          onSelect={() => undefined}
          selectedId="s1"
          sessions={[session]}
        />
      </TooltipProvider>
    </LocaleProvider>,
  );
  return { onDelete, onRename, onRequestCreate };
}

describe("SessionSidebar 会话操作", () => {
  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
  });

  it("删除前弹出确认，取消不会真正删除", () => {
    const { onDelete } = renderSidebar();
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: "Demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /delete session/i }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("确认后才会删除会话", () => {
    const { onDelete } = renderSidebar();
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: "Demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /delete session/i }));
    const confirms = screen.getAllByRole("button", { name: /delete session/i });
    fireEvent.click(confirms[confirms.length - 1]);
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("点击新建按钮不会把鼠标事件当作初始目录传出", () => {
    const { onRequestCreate } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /new task/i }));
    expect(onRequestCreate).toHaveBeenCalledWith();
  });
});
