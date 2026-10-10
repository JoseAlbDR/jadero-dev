import { request } from "node:http";

/** What {@link rawGet} answers. */
export interface RawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

/**
 * A GET with exactly the given headers, through `node:http`. `fetch` cannot send a plain
 * conditional request: the Fetch standard turns a request carrying `If-None-Match` into cache mode
 * `no-store` and adds `Cache-Control: no-cache`, which Express's freshness check (`fresh`) always
 * treats as stale, so the server would never answer 304. A shared cache revalidating its copy (nginx
 * with `proxy_cache_revalidate`) sends no such header.
 * @param url the absolute URL.
 * @param headers the request headers, sent as is.
 * @returns the status, the response headers and the body as text.
 */
export function rawGet(url: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}
