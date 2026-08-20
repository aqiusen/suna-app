import { describe, expect, it, vi } from "vitest";
import {
  bindDesktopUnloadShutdown,
  isDesktopShell,
  requestGatewayShutdown,
} from "./gatewayShutdown";

describe("requestGatewayShutdown", () => {
  it("POSTs /api/v1/shutdown", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    await requestGatewayShutdown(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/shutdown", {
      method: "POST",
    });
  });

  it("detects desktop shell from query", () => {
    expect(isDesktopShell("?desktop=1")).toBe(true);
    expect(isDesktopShell("")).toBe(false);
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
