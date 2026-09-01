import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import type { SettingsTabProps } from "./RuntimeSettings";
import { ModelsTab } from "./ModelsTab";

function renderModelsTab(
  rpc = vi.fn(),
  modelDiscovery?: { provider: string; models?: string[]; sequence: number },
) {
  return render(
    <LocaleProvider>
      <ModelsTab
        {...({
          cap: (name: string) => name === "config.discoverModels",
          config: {
            active_model: "openai/gpt-5.5",
            models: [
              {
                provider: "openai",
                protocol: "openai_chat",
                model: "gpt-5.5",
                base_url: "https://api.example.com/v1",
                has_api_key: true,
              },
              {
                provider: "openai",
                protocol: "openai_chat",
                model: "gpt-4o",
                base_url: "https://other.example.com/v1",
                has_api_key: true,
              },
            ],
          },
          onApplySessionModel: vi.fn(),
          onConfig: vi.fn(),
          modelDiscovery,
          rpc,
        } as unknown as SettingsTabProps)}
      />
    </LocaleProvider>,
  );
}

describe("ModelsTab 模型列表缓存", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => store.delete(key),
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
    window.localStorage.clear();
  });

  it("下载后的模型列表只绑定当前 provider/protocol/endpoint", async () => {
    const rpc = vi.fn().mockResolvedValue({
      status: "processing",
    });
    const view = renderModelsTab(rpc);

    fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /fetch model list/i }));

    expect(rpc).toHaveBeenCalledWith("config.discoverModels", {
      provider: "openai",
    });
    view.rerender(
      <LocaleProvider>
        <ModelsTab
          {...({
            cap: (name: string) => name === "config.discoverModels",
            config: {
              active_model: "openai/gpt-5.5",
              models: [
                {
                  provider: "openai",
                  protocol: "openai_chat",
                  model: "gpt-5.5",
                  base_url: "https://api.example.com/v1",
                  has_api_key: true,
                },
                {
                  provider: "openai",
                  protocol: "openai_chat",
                  model: "gpt-4o",
                  base_url: "https://other.example.com/v1",
                  has_api_key: true,
                },
              ],
            },
            modelDiscovery: {
              provider: "openai",
              models: ["gpt-5.2", "gpt-5.5"],
              sequence: 1,
            },
            onApplySessionModel: vi.fn(),
            onConfig: vi.fn(),
            rpc,
          } as unknown as SettingsTabProps)}
        />
      </LocaleProvider>,
    );

    expect(await screen.findByRole("button", { name: "gpt-5.2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    expect(screen.getByRole("button", { name: "gpt-5.2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[1]);
    expect(screen.queryByRole("button", { name: "gpt-5.2" })).toBeNull();
  });
});
