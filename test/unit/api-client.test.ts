import { describe, expect, test } from "bun:test";
import { API_PREFIX, ApiClient, ApiError, type FetchLike } from "@nexus/client";

interface Recorded {
  url: string;
  init: RequestInit;
}

const recorder = (respond: (url: string, init: RequestInit) => Response) => {
  const calls: Recorded[] = [];
  const fakeFetch = (async (input: string, init?: RequestInit): Promise<Response> => {
    const requestInit = init ?? {};
    calls.push({ url: input, init: requestInit });
    return respond(input, requestInit);
  }) as unknown as FetchLike;
  return { calls, fetch: fakeFetch };
};

const ok = (body: unknown, status = 200): Response => Response.json(body, { status });
const headersOf = (init: RequestInit): Record<string, string> =>
  (init.headers ?? {}) as Record<string, string>;

describe("ApiClient", () => {
  test("login posts the credentials without a bearer token", async () => {
    const { calls, fetch } = recorder(() =>
      ok({ token: "nx_t_s", user: { id: "u1", handle: "owner", createdAt: "now" } }),
    );
    const client = new ApiClient({ baseUrl: "http://api.test", fetch });
    const result = await client.login({ handle: "owner", secret: "s" });

    expect(result.token).toBe("nx_t_s");
    expect(calls[0]?.url).toBe("http://api.test/login");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe('{"handle":"owner","secret":"s"}');
    expect(headersOf(calls[0]?.init ?? {}).authorization).toBeUndefined();
  });

  test("sends the bearer token once one is set", async () => {
    const { calls, fetch } = recorder(() =>
      ok({ user: { id: "u1", handle: "o", createdAt: "n" } }),
    );
    const client = new ApiClient({ fetch });
    client.setToken("nx_t_s");
    await client.me();
    expect(headersOf(calls[0]?.init ?? {}).authorization).toBe("Bearer nx_t_s");
  });

  test("clears the token", async () => {
    const { calls, fetch } = recorder(() => ok({ projects: [] }));
    const client = new ApiClient({ token: "nx_t_s", fetch });
    client.setToken(null);
    await client.listProjects();
    expect(headersOf(calls[0]?.init ?? {}).authorization).toBeUndefined();
  });

  test("surfaces the server's error message and status", async () => {
    const { fetch } = recorder(() => ok({ error: { message: "no such session: abc" } }, 404));
    const client = new ApiClient({ fetch });
    const failure = client.getSession("abc");
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 404, message: "no such session: abc" });
  });

  test("falls back to the status line when the error envelope is missing", async () => {
    const { fetch } = recorder(() => new Response("nope", { status: 502 }));
    const client = new ApiClient({ fetch });
    await expect(client.listProjects()).rejects.toMatchObject({ status: 502 });
  });

  test("encodes the content path as a query parameter", async () => {
    const { calls, fetch } = recorder(() =>
      ok({ content: { kind: "directory", path: "", entries: [] } }),
    );
    const client = new ApiClient({ fetch });
    await client.getProjectContent("p1", "src/a b.ts");
    expect(calls[0]?.url).toBe(`${API_PREFIX}/projects/p1/content?path=src%2Fa+b.ts`);
  });

  test("sends force only when asked", async () => {
    const { calls, fetch } = recorder(() => ok({ deleted: true, preservedBranch: "pi/x" }));
    const client = new ApiClient({ fetch });
    await client.deleteSession("s1");
    await client.deleteSession("s1", { force: true });
    expect(calls[0]?.url).toBe(`${API_PREFIX}/sessions/s1`);
    expect(calls[1]?.url).toBe(`${API_PREFIX}/sessions/s1?force=true`);
  });

  test("encodes ids in the path", async () => {
    const { calls, fetch } = recorder(() => ok({ session: {} }));
    const client = new ApiClient({ fetch });
    await client.getSession("a/b");
    expect(calls[0]?.url).toBe(`${API_PREFIX}/sessions/a%2Fb`);
  });

  test("passes an abort signal through", async () => {
    const { calls, fetch } = recorder(() => ok({ projects: [] }));
    const client = new ApiClient({ fetch });
    const controller = new AbortController();
    await client.listProjects({ signal: controller.signal });
    expect(calls[0]?.init.signal).toBe(controller.signal);
  });

  test("calls the global fetch with the global as its receiver", async () => {
    // A browser's fetch throws "Illegal invocation" when invoked with any other receiver. Storing it
    // in a field and calling it as a method does exactly that, and Bun tolerates it silently — so the
    // mistake only ever appears in a browser unless it is pinned here.
    const original = globalThis.fetch;
    let receiver: unknown = "never called";
    globalThis.fetch = function (this: unknown): Promise<Response> {
      receiver = this;
      return Promise.resolve(ok({ projects: [] }));
    } as unknown as typeof globalThis.fetch;
    try {
      await new ApiClient().listProjects();
    } finally {
      globalThis.fetch = original;
    }
    expect(receiver === globalThis || receiver === undefined).toBe(true);
  });
});
