import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import { TooltipProvider } from "../../components/ui/Tooltip";
import { SessionHeader } from "./SessionHeader";

function renderHeader(
  overrides: Partial<Parameters<typeof SessionHeader>[0]> = {},
) {
  const onStop = vi.fn();
  render(
    <LocaleProvider>
      <TooltipProvider>
        <SessionHeader
          canControl
          handoffRole="host"
          onOpenMobileMenu={() => undefined}
          onOpenSettings={() => undefined}
          onStop={onStop}
          onToggleTheme={() => undefined}
          resolvedTheme="light"
          running
          selected={{
            id: "s1",
            title: "Test",
            cwd: "/workspace",
            status: "running",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 0,
            client_count: 1,
          }}
          syncing={false}
          {...overrides}
        />
      </TooltipProvider>
    </LocaleProvider>,
  );
  return { onStop };
}

describe("SessionHeader 停止两段式", () => {
  it("第一次点击只进入确认态，不停止", () => {
    const { onStop } = renderHeader();
    // 初始是"停止"文案（en: Stop）。
    const stopButton = screen.getByText(/^stop$/i);
    expect(stopButton).toBeTruthy();
    fireEvent.click(stopButton);
    // 进入确认态后文案变为"确认停止？"，onStop 未调用。
    expect(screen.getByText(/confirm stop/i)).toBeTruthy();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("确认态下再点才真正停止", () => {
    const { onStop } = renderHeader();
    const stopButton = screen.getByText(/^stop$/i);
    fireEvent.click(stopButton);
    const confirmButton = screen.getByText(/confirm stop/i);
    fireEvent.click(confirmButton);
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
