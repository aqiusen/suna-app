import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LocaleProvider, useT } from "./i18n";

function SettingsLabels() {
  const t = useT();
  return (
    <>
      <span>{t("settings.title")}</span>
      <span>{t("settings.tab.connection")}</span>
      <span>{t("conn.theme")}</span>
      <span>{t("conn.language")}</span>
    </>
  );
}

describe("LocaleProvider", () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, "language", {
      configurable: true,
      value: "zh-CN",
    });
  });

  it("renders settings labels instead of raw translation keys", () => {
    render(
      <LocaleProvider>
        <SettingsLabels />
      </LocaleProvider>,
    );

    expect(screen.getByText("Suna 设置")).toBeTruthy();
    expect(screen.getByText("连接")).toBeTruthy();
    expect(screen.getByText("主题")).toBeTruthy();
    expect(screen.getByText("语言")).toBeTruthy();
  });
});
