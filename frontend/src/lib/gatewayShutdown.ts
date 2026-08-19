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
