import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import type { SettingsTabProps } from "./RuntimeSettings";
import { SecurityTab } from "./SecurityTab";

const props = {
  config: { models: [], active_model: "" },
  onConfig: vi.fn(),
  rpc: vi.fn(),
} as unknown as SettingsTabProps;

describe("SecurityTab Guard 默认值", () => {
  it("config 未带 guard_mode 时高亮 Ask，而不是 Smart", () => {
    render(
      <LocaleProvider>
        <SecurityTab {...props} />
      </LocaleProvider>,
    );
    expect(
      screen.getByRole("button", { name: /^Ask/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /^Smart/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

describe("SecurityTab Workspace", () => {
  it("通过 Runtime 保存新的工作目录", async () => {
    const onConfig = vi.fn();
    const rpc = vi.fn().mockResolvedValue({
      models: [],
      active_model: "",
      workspace: "/new/project",
    });
    render(
      <LocaleProvider>
        <SecurityTab
          {...(props as unknown as SettingsTabProps)}
          config={{ models: [], active_model: "", workspace: "/old/project" }}
          onConfig={onConfig}
          rpc={rpc as SettingsTabProps["rpc"]}
        />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByLabelText("Directory path"), {
      target: { value: "/new/project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("config.set", {
        action: "update_general",
        workspace: "/new/project",
      }),
    );
    expect(onConfig).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: "/new/project" }),
    );
  });

  it("清空已有目录前确认，并向 Runtime 发送空值", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const rpc = vi.fn().mockResolvedValue({
      models: [],
      active_model: "",
    });
    render(
      <LocaleProvider>
        <SecurityTab
          {...(props as unknown as SettingsTabProps)}
          config={{ models: [], active_model: "", workspace: "/project" }}
          rpc={rpc as SettingsTabProps["rpc"]}
        />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByLabelText("Directory path"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("config.set", {
        action: "update_general",
        workspace: "",
      }),
    );
    vi.unstubAllGlobals();
  });
});
