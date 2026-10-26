/** Public IFCDC payments. Production host is fixed; all provider calls are bounded. */
export class ProviderError extends Error {
  constructor(public status: number) { super("PayPal could not confirm this request."); }
}
export function publicPayPal(config: { clientId: string; clientSecret: string }, fetchImpl: typeof fetch = fetch) {
  async function request(path: string, method = "GET", body?: object, key?: string, accessToken?: string): Promise<any> {
    const signal = AbortSignal.timeout(10_000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const oauth = path === "/v1/oauth2/token";
          const response = await fetchImpl("https://api-m.paypal.com" + path, {
            method, redirect: "error", signal,
            headers: { Authorization: oauth ? "Basic " + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64") : `Bearer ${accessToken}`,
              "Content-Type": oauth ? "application/x-www-form-urlencoded" : "application/json",
              ...(key ? { "PayPal-Request-Id": key } : {}), Prefer: "return=representation" },
            ...(method === "GET" ? {} : { body: oauth ? "grant_type=client_credentials" : JSON.stringify(body) }),
          });
          if (!response.ok || response.redirected) throw new ProviderError(response.status);
          if (response.status === 204) return {};
          const data = await response.json();
          if (!data || typeof data !== "object" || Array.isArray(data)) throw new ProviderError(502);
          return data;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new ProviderError(504)), 10_000); }),
      ]);
    } catch (error) {
      throw error instanceof ProviderError ? error : new ProviderError(502);
    } finally { clearTimeout(timer); }
  }
  return async (path: string, method = "GET", body?: object, key?: string): Promise<any> => {
    const oauth = await request("/v1/oauth2/token", "POST");
    if (oauth.token_type !== "Bearer" || typeof oauth.access_token !== "string" || !/^[^\s\x00-\x1f\x7f]+$/.test(oauth.access_token)) throw new ProviderError(502);
    return request(path, method, body, key, oauth.access_token);
  };
}
