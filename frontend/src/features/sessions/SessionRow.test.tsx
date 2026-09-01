import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import { TooltipProvider } from "../../components/ui/Tooltip";
import { SessionRow } from "./SessionRow";
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

function renderRow(overrides: Partial<Parameters<typeof SessionRow>[0]> = {}) {
  const onDelete = vi.fn();
  const onRename = vi.fn();
  const onSelect = vi.fn();
  render(
    <LocaleProvider>
      <TooltipProvider>
        <SessionRow
          disabled={false}
          joining={false}
          onDelete={onDelete}
          onRename={onRename}
          onSelect={onSelect}
          selected
          session={session}
          {...overrides}
        />
      </TooltipProvider>
    </LocaleProvider>,
  );
  return { onDelete, onRename, onSelect };
}

describe("SessionRow", () => {
  it("可以重命名和删除会话", () => {
    const { onDelete, onRename } = renderRow();
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete session/i }));
    expect(onRename).toHaveBeenCalledWith("s1");
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("将完成状态显示在左侧状态点", () => {
    renderRow({ terminalState: "success" });

    expect(screen.getByRole("status", { name: "任务完成" })).toBeTruthy();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
