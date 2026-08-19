import { describe, expect, it, vi } from "vitest";
import { requestGatewayShutdown } from "./gatewayShutdown";

describe("requestGatewayShutdown", () => {
  it("POSTs /api/v1/shutdown", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    await requestGatewayShutdown(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/shutdown", { method: "POST" });
  });

  it("throws when the gateway refuses", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(
      requestGatewayShutdown(fetcher as unknown as typeof fetch),
    ).rejects.toThrow("403");
  });
});
