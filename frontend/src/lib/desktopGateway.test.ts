import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureGatewayBaseUrl,
  gatewayPath,
  getDesktopToken,
  getGatewayBaseUrl,
  isNativeDesktopShell,
} from "./desktopGateway";

beforeEach(() => {
  delete window.__SUNA_GATEWAY_BASE_URL__;
  delete window.__SUNA_DESKTOP_TOKEN__;
  delete window.go;
});

describe("desktopGateway", () => {
  it("defaults to relative Gateway requests outside Wails", async () => {
    await configureGatewayBaseUrl();
    expect(getGatewayBaseUrl()).toBe("");
    expect(isNativeDesktopShell()).toBe(false);
  });

  it("reads the loopback Gateway URL from Wails", async () => {
    window.go = {
      main: {
        App: {
          GatewayAuth: vi.fn().mockResolvedValue({
            base_url: "http://127.0.0.1:49152/",
            desktop_token: "test-token",
          }),
        },
      },
    };
    await configureGatewayBaseUrl();
    expect(getGatewayBaseUrl()).toBe("http://127.0.0.1:49152");
    expect(getDesktopToken()).toBe("test-token");
    expect(gatewayPath("/api/v1/bridge/connect")).toBe(
      "http://127.0.0.1:49152/api/v1/bridge/connect?desktop_token=test-token",
    );
    expect(isNativeDesktopShell()).toBe(true);
  });

  it("rejects non-loopback native Gateway URLs", async () => {
    window.go = {
      main: {
        App: {
          GatewayAuth: vi.fn().mockResolvedValue({
            base_url: "https://example.com",
          }),
        },
      },
    };
    await expect(configureGatewayBaseUrl()).rejects.toThrow("loopback");
  });
});
