/**
 * 本机退出 Gateway。远端（手机）会被 403；进程已退出时 fetch 会抛网络错误。
 */
export async function requestGatewayShutdown(
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("/api/v1/shutdown", { method: "POST" });
  if (!response.ok) {
    throw new Error(`shutdown rejected: ${response.status}`);
  }
}

export function isDesktopShell(
  search: string = window.location.search,
): boolean {
  return new URLSearchParams(search).has("desktop");
}

/** 桌面 --app 窗口关掉时立刻通知 Gateway 停 daemon，不等 45s idle。 */
export function bindDesktopUnloadShutdown(
  sendBeacon: (url: string) => boolean = (url) =>
    navigator.sendBeacon(url, new Blob([], { type: "text/plain" })),
): () => void {
  if (!isDesktopShell()) return () => undefined;
  const onHide = () => {
    try {
      sendBeacon("/api/v1/shutdown");
    } catch {
      // 页面正在卸载，失败也无后续处理。
    }
  };
  window.addEventListener("pagehide", onHide);
  return () => window.removeEventListener("pagehide", onHide);
}
