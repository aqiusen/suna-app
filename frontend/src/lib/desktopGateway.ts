type WailsAppBinding = {
  GatewayAuth?: () => Promise<{
    base_url?: string;
    desktop_token?: string;
  }>;
  /** 原生多选文件对话框，返回本机绝对路径（仅桌面壳存在）。 */
  SelectFiles?: () => Promise<
    { path: string; name: string; mime_type?: string; size?: number }[]
  >;
  /** 原生文件夹选择对话框。 */
  SelectDirectory?: () => Promise<
    { path: string; name: string; mime_type?: string; size?: number }[]
  >;
  /** 把粘贴事件里的 file:// URL 解析为本机路径。 */
  ResolvePastedFiles?: (
    fileURLs: string[],
  ) => Promise<
    { path: string; name: string; mime_type?: string; size?: number }[]
  >;
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

export function hasNativeFileDialogs(): boolean {
  return Boolean(appBinding()?.SelectFiles || appBinding()?.SelectDirectory);
}

/** 桌面壳原生文件选择结果。 */
export type PickedFile = {
  path: string;
  name: string;
  mime_type?: string;
  size?: number;
};

const appBinding = () => window.go?.main?.App;

/** 打开系统多选文件对话框（仅桌面壳）。 */
export async function selectLocalFiles(): Promise<PickedFile[]> {
  const files = await appBinding()?.SelectFiles?.();
  return Array.isArray(files) ? files : [];
}

/** 打开系统文件夹选择对话框（仅桌面壳）。 */
export async function selectLocalDirectory(): Promise<PickedFile[]> {
  const files = await appBinding()?.SelectDirectory?.();
  return Array.isArray(files) ? files : [];
}

/** 把粘贴/拖拽事件里的 file:// URL 解析为本机路径（仅桌面壳）。 */
export async function resolvePastedFiles(
  fileURLs: string[],
): Promise<PickedFile[]> {
  if (fileURLs.length === 0) return [];
  const files = await appBinding()?.ResolvePastedFiles?.(fileURLs);
  return Array.isArray(files) ? files : [];
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
