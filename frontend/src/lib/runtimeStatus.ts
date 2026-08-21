import type { RuntimeCatalog } from "./runtimeTypes";

export type RuntimeState =
  | { kind: "loading" }
  | { kind: "ready"; runtimeVersion: string; catalog: RuntimeCatalog }
  | {
      kind: "unavailable" | "protocol_error" | "capability_error";
      code: string;
      message: string;
    };

type RuntimeStatusResponse = {
  status?: unknown;
  runtime?: {
    runtime_version?: unknown;
    catalog?: Partial<RuntimeCatalog>;
  };
  error?: { code?: unknown; message?: unknown };
};

const requestTimeout = 8_000;

export async function getRuntimeStatus(
  signal?: AbortSignal,
): Promise<RuntimeState> {
  try {
    const response = await fetch("/api/v1/runtime/status", {
      headers: { Accept: "application/json" },
      signal,
    });
    const body = (await response.json()) as RuntimeStatusResponse;

    if (
      response.ok &&
      body.status === "ready" &&
      typeof body.runtime?.runtime_version === "string" &&
      Array.isArray(body.runtime?.catalog?.methods)
    ) {
      return {
        kind: "ready",
        runtimeVersion: body.runtime.runtime_version,
        catalog: {
          methods: body.runtime.catalog?.methods ?? [],
          notifications: body.runtime.catalog?.notifications ?? [],
          features: body.runtime.catalog?.features ?? [],
        },
      };
    }
    if (
      (body.status === "unavailable" ||
        body.status === "protocol_error" ||
        body.status === "capability_error") &&
      typeof body.error?.code === "string" &&
      typeof body.error.message === "string"
    ) {
      return {
        kind: body.status,
        code: body.error.code,
        message: body.error.message,
      };
    }
  } catch {
    // 网络和无效响应都会安全地归为 Runtime 不可用。
  }
  return {
    kind: "unavailable",
    code: "unavailable",
    message: "Runtime is unavailable.",
  };
}

export function createRequestSignal() {
  return AbortSignal.timeout(requestTimeout);
}
