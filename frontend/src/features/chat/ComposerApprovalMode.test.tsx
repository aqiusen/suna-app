import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import { ComposerApprovalMode } from "./ComposerApprovalMode";

/** jsdom 默认 en-US，文案按英文断言。 */
function renderMode(
  props: Partial<Parameters<typeof ComposerApprovalMode>[0]> = {},
) {
  const onSave = vi.fn<(mode: string) => Promise<void>>();
  onSave.mockResolvedValue(undefined);
  render(
    <LocaleProvider>
      <ComposerApprovalMode onSave={onSave} {...props} />
    </LocaleProvider>,
  );
  return { onSave };
}

function trigger() {
  return screen.getByRole("button", { name: "Guard mode" });
}

describe("ComposerApprovalMode 对齐 Runtime Guard", () => {
  it("空值按 Runtime 默认显示 Ask，而不是 Smart", () => {
    renderMode();
    expect(trigger().textContent).toContain("Ask");
    expect(trigger().textContent).not.toContain("Smart");
  });

  it("打开后列出四个 Runtime mode，且只读可改", async () => {
    const { onSave } = renderMode({ value: "readonly" });
    expect(trigger().textContent).toContain("Read-only");

    fireEvent.click(trigger());
    expect(
      screen.getByRole("button", { name: /Allow only proven read-only/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /ask you on medium\/high risk/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /AI reviews medium\/high risk/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /hard blocks and workspace/ }),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /ask you on medium\/high risk/ }),
      );
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith("ask");
  });

  it("选择 Auto 会保存 auto，而不是伪造 unrestricted", async () => {
    const { onSave } = renderMode({ value: "ask" });
    fireEvent.click(trigger());
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /hard blocks and workspace/ }),
      );
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith("auto");
  });
});
