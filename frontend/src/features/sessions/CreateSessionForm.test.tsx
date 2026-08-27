import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import { CreateSessionForm } from "./CreateSessionForm";

vi.mock("../../lib/desktopGateway", () => ({
  isNativeDesktopShell: () => true,
  resolvePastedFiles: vi.fn().mockResolvedValue([]),
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
  it("选择文件夹后会填入工作目录并提交", async () => {
    const { onCreate } = renderForm();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/session title/i), {
        target: { value: "Demo" },
      });
      fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: /create session/i }));

    expect(onCreate).toHaveBeenCalledWith("/Users/me/demo-project", "Demo");
  });

  it("创建时不维护最近项目，并保持工作目录为空", () => {
    renderForm();

    expect(screen.queryByRole("button", { name: /^alpha$/i })).toBeNull();
    expect(screen.getByLabelText(/folder path/i)).toHaveProperty("value", "");
  });

  it("从目录菜单打开时预填工作目录且不自动命名", () => {
    renderForm({ initialCwd: "/Users/me/demo-project" });

    expect(screen.getByLabelText(/folder path/i)).toHaveProperty(
      "value",
      "/Users/me/demo-project",
    );
    expect(screen.getByLabelText(/session title/i)).toHaveProperty("value", "");
  });

  it("拖入带本机路径的文件夹后会填入路径", async () => {
    renderForm();
    const dropzone = screen.getByLabelText(/drop a folder here/i);
    const file = new File([""], "demo-project");
    Object.defineProperty(file, "path", {
      configurable: true,
      value: "/Users/me/demo-project",
    });

    await act(async () => {
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await Promise.resolve();
    });

    expect(screen.getByLabelText(/folder path/i)).toHaveProperty(
      "value",
      "/Users/me/demo-project",
    );
    expect(screen.getByLabelText(/session title/i)).toHaveProperty("value", "");
  });
});
