import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindDesktopUnloadShutdown,
  isDesktopShell,
  requestGatewayShutdown,
} from "./gatewayShutdown";

beforeEach(() => {
  delete window.__SUNA_GATEWAY_BASE_URL__;
  delete window.__SUNA_DESKTOP_TOKEN__;
  delete window.go;
});

describe("requestGatewayShutdown", () => {
  it("POSTs /api/v1/shutdown", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    await requestGatewayShutdown(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/shutdown", {
      method: "POST",
    });
  });

  it("uses the native gateway base URL when present", async () => {
    window.__SUNA_GATEWAY_BASE_URL__ = "http://127.0.0.1:49152";
    window.__SUNA_DESKTOP_TOKEN__ = "test-token";
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    await requestGatewayShutdown(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:49152/api/v1/shutdown?desktop_token=test-token",
      { method: "POST" },
    );
  });

  it("detects desktop shell from query", () => {
    expect(isDesktopShell("?desktop=1")).toBe(true);
    expect(isDesktopShell("")).toBe(false);
  });

  it("detects native desktop shell from Wails binding", () => {
    window.go = {
      main: {
        App: {
          GatewayAuth: vi.fn(),
        },
      },
    };
    expect(isDesktopShell("")).toBe(true);
  });

  it("binds pagehide shutdown only in desktop shell", () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const original = window.location.search;
    Object.defineProperty(window, "location", {
      value: { ...window.location, search: "?desktop=1" },
      writable: true,
    });
    const unbind = bindDesktopUnloadShutdown(sendBeacon);
    window.dispatchEvent(new Event("pagehide"));
    expect(sendBeacon).toHaveBeenCalledWith("/api/v1/shutdown");
    unbind();
    Object.defineProperty(window, "location", {
      value: { ...window.location, search: original },
      writable: true,
    });
  });

  it("throws when the gateway refuses", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(
      requestGatewayShutdown(fetcher as unknown as typeof fetch),
    ).rejects.toThrow("403");
  });
});
