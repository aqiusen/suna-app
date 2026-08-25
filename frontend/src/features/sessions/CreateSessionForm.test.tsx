import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import { CreateSessionForm } from "./CreateSessionForm";

vi.mock("../../lib/desktopGateway", () => ({
  isNativeDesktopShell: () => true,
  selectLocalDirectory: vi
    .fn()
    .mockResolvedValue([
      { path: "/Users/me/demo-project", name: "demo-project" },
    ]),
}));

function renderForm(
  props: Partial<Parameters<typeof CreateSessionForm>[0]> = {},
) {
  const onCreate = vi.fn<() => Promise<void>>();
  render(
    <LocaleProvider>
      <CreateSessionForm onCancel={vi.fn()} onCreate={onCreate} {...props} />
    </LocaleProvider>,
  );
  return { onCreate };
}

describe("CreateSessionForm", () => {
  it("选择文件夹后会填入项目路径并提交", async () => {
    const { onCreate } = renderForm();

    fireEvent.change(screen.getByLabelText(/project name/i), {
      target: { value: "Demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));

    expect(onCreate).toHaveBeenCalledWith("/Users/me/demo-project", "Demo");
  });

  it("会显示最近项目候选", () => {
    localStorage.setItem(
      "suna-app:recent-projects",
      JSON.stringify(["/Users/me/alpha"]),
    );

    renderForm({ knownCwds: ["/Users/me/beta"] });

    expect(screen.getByRole("button", { name: /alpha/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /beta/i })).toBeDefined();
  });
});
