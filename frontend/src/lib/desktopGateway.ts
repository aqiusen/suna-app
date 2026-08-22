type WailsAppBinding = {
  GatewayAuth?: () => Promise<{
    base_url?: string;
    desktop_token?: string;
  }>;
};

declare global {
  interface Window {
    __SUNA_GATEWAY_BASE_URL__?: string;
    __SUNA_DESKTOP_TOKEN__?: string;
    go?: {
      main?: {
        App?: WailsAppBinding;
      };
    };
  }
}

export function getGatewayBaseUrl(): string {
  return window.__SUNA_GATEWAY_BASE_URL__ ?? "";
}

export function getDesktopToken(): string {
  return window.__SUNA_DESKTOP_TOKEN__ ?? "";
}

export function gatewayPath(path: string): string {
  const token = getDesktopToken();
  if (!token) return `${getGatewayBaseUrl()}${path}`;
  const url = new URL(path, getGatewayBaseUrl());
  url.searchParams.set("desktop_token", token);
  return url.toString();
}

export function isNativeDesktopShell(): boolean {
  return typeof window.go?.main?.App?.GatewayAuth === "function";
}

export async function configureGatewayBaseUrl(): Promise<void> {
  const auth = await window.go?.main?.App?.GatewayAuth?.();
  if (!auth) return;
  if (typeof auth.base_url !== "string" || auth.base_url.trim() === "") return;
  window.__SUNA_GATEWAY_BASE_URL__ = normalizeLoopbackBaseUrl(auth.base_url);
  if (typeof auth.desktop_token === "string") {
    window.__SUNA_DESKTOP_TOKEN__ = auth.desktop_token;
  }
}

function normalizeLoopbackBaseUrl(value: string): string {
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "http:" ||
    (host !== "127.0.0.1" && host !== "localhost" && host !== "::1")
  ) {
    throw new Error("native gateway URL must be a loopback HTTP URL");
  }
  return parsed.origin;
}
