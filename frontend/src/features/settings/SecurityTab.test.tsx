import { render, screen } from "@testing-library/react";
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
