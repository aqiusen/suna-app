import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/project name/i), {
        target: { value: "Demo" },
      });
      fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));

    expect(onCreate).toHaveBeenCalledWith("/Users/me/demo-project", "Demo");
  });

  it("创建时不显示最近项目标签，并保持文件夹为空", () => {
    localStorage.setItem(
      "suna-app:recent-projects",
      JSON.stringify(["/Users/me/alpha"]),
    );

    renderForm();

    expect(screen.queryByRole("button", { name: /^alpha$/i })).toBeNull();
    expect(screen.getByLabelText(/folder path/i)).toHaveProperty("value", "");
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
    expect(screen.getByLabelText(/project name/i)).toHaveProperty(
      "value",
      "demo-project",
    );
  });
});
