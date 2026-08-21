import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimeBridgeClient } from "./runtimeBridge";

class FakeEventSource {
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  addEventListener() {}

  close() {
    this.closed = true;
  }

  fail() {
    this.onerror?.();
  }
}

const hello = {
  runtime_version: "1",
  transport: "stdio",
  catalog: { methods: [], notifications: [], features: [] },
  content_sources: {},
};

afterEach(() => vi.restoreAllMocks());

describe("RuntimeBridgeClient stream lifecycle", () => {
  it("ignores an old EventSource error after explicit reconnect", async () => {
    const sources: FakeEventSource[] = [];
    let connectCount = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/connect")) {
        connectCount++;
        return Response.json({ id: `bridge-${connectCount}`, hello });
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ result: {} });
    });
    const client = new RuntimeBridgeClient({
      fetch: fetcher as typeof fetch,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source as unknown as EventSource;
      },
    });

    await client.connect();
    client.subscribe(() => undefined);
    const oldSource = sources[0];
    await client.disconnect();
    await client.connect();
    client.subscribe(() => undefined);
    const newConnection = client.currentConnection();

    oldSource.fail();
    await Promise.resolve();
    await Promise.resolve();

    expect(oldSource.closed).toBe(true);
    expect(client.currentConnection()).toBe(newConnection);
    expect(sources).toHaveLength(2);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith("/connect")),
    ).toHaveLength(2);
  });
});
