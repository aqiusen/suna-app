import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import { Composer } from "./Composer";

vi.mock("../../lib/desktopGateway", () => ({
  isNativeDesktopShell: () => true,
  resolvePastedFiles: vi.fn().mockResolvedValue([]),
  selectLocalDirectory: vi.fn().mockResolvedValue([]),
  selectLocalFiles: vi.fn().mockResolvedValue([]),
}));

/** 包裹 LocaleProvider：组件内部 useT() 需要 context。 */
function renderComposer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSubmit = vi.fn<() => Promise<void>>();
  render(
    <LocaleProvider>
      <Composer onSubmit={onSubmit} {...props} />
    </LocaleProvider>,
  );
  return { onSubmit };
}

function type(text: string) {
  const textarea = screen.getByRole("textbox", { name: /message suna/i });
  fireEvent.change(textarea, { target: { value: text } });
  return textarea;
}

describe("Composer 乐观清空状态机", () => {
  it("发送成功后清空草稿", async () => {
    const { onSubmit } = renderComposer();
    onSubmit.mockResolvedValue(undefined);

    const textarea = type("hello");
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    expect(onSubmit).toHaveBeenCalledWith([{ type: "text", text: "hello" }]);
    // 发送瞬间草稿已清空（乐观清空）。
    expect(textarea).toHaveProperty("value", "");
  });

  it("发送失败时恢复草稿", async () => {
    const { onSubmit } = renderComposer();
    onSubmit.mockRejectedValue(new Error("boom"));

    const textarea = type("keep me");
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    // 等失败处理完成（microtask）后草稿恢复。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textarea).toHaveProperty("value", "keep me");
  });

  it("空草稿时发送按钮禁用", () => {
    renderComposer();
    const button = screen.getByRole("button", { name: /send message/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("Enter 发送（非 Shift）", () => {
    const { onSubmit } = renderComposer();
    onSubmit.mockResolvedValue(undefined);

    const textarea = type("enter send");
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("Shift+Enter 不发送（换行）", () => {
    const { onSubmit } = renderComposer();
    onSubmit.mockResolvedValue(undefined);

    const textarea = type("shift enter");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Composer 模型选择器", () => {
  it("传入模型列表时渲染选择器", () => {
    renderComposer({
      models: [
        { provider: "openai", protocol: "openai_chat", model: "gpt-4o" },
      ],
      activeModel: "openai/gpt-4o",
      onModelChange: vi.fn(),
    });
    // 模型选择器 trigger 应存在，并按 Codex 风格显示短模型名 + 推理强度。
    expect(screen.getByRole("button", { name: /change model/i })).toBeDefined();
    expect(screen.getByText("4o")).toBeDefined();
    expect(screen.getByText("M")).toBeDefined();
  });

  it("点击后先显示主菜单，hover 后联动展开二级菜单", () => {
    renderComposer({
      models: [
        { provider: "openai", protocol: "openai_chat", model: "gpt-4o" },
        {
          provider: "openai",
          protocol: "openai_chat",
          model: "gpt-5.5",
          reasoning: { effort: "high" },
        },
      ],
      activeModel: "openai/gpt-4o",
      onModelChange: vi.fn(),
      onReasoningChange: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole("button", { name: /change model/i }));
    expect(screen.getByText("Model")).toBeDefined();
    expect(screen.getByText("Reasoning")).toBeDefined();
    expect(screen.queryByRole("button", { name: "5.5" })).toBeNull();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /Model4o/i }));
    expect(screen.getByRole("button", { name: "5.5" })).toBeDefined();

    fireEvent.mouseEnter(
      screen.getByRole("button", { name: /ReasoningMedium/i }),
    );
    expect(screen.getByRole("button", { name: "Low" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Medium" })).toBeDefined();
    expect(screen.getByRole("button", { name: "High" })).toBeDefined();
  });

  it("无模型列表时不渲染选择器", () => {
    renderComposer();
    expect(screen.queryByText("openai/gpt-4o")).toBeNull();
  });
});

describe("Composer + 附件面板", () => {
  it("+ 按钮点击展开附件 dropdown", () => {
    renderComposer({ canAttachImageUrl: true });
    const plusButton = screen.getByRole("button", {
      name: /add attachments/i,
    });
    fireEvent.click(plusButton);
    expect(screen.getByRole("button", { name: /attach files/i })).toBeDefined();
    expect(
      screen.getByRole("button", { name: /attach folder/i }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /image url/i })).toBeDefined();
  });

  it("+ 按钮再次点击收起附件 dropdown", () => {
    renderComposer({ canAttachImageUrl: true });
    const plusButton = screen.getByRole("button", {
      name: /add attachments/i,
    });
    fireEvent.click(plusButton);
    fireEvent.click(plusButton);
    // 收起后 dropdown 消失，不再有 Image URL 菜单项。
    expect(screen.queryByRole("button", { name: /image url/i })).toBeNull();
  });
});
