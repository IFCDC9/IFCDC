export interface ApiClientConfig {
  baseUrl: string;
  token?: string;
  headers?: Record<string, string>;
}

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApiClient(config: ApiClientConfig) {
  const { baseUrl, token, headers = {} } = config;

  function buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
      ...extra,
    };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${baseUrl.replace(/\/$/, "")}${path}`;
    try {
      const response = await fetch(url, {
        method,
        headers: buildHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await response.text();
      const data = text ? (JSON.parse(text) as T) : null;

      if (!response.ok) {
        return {
          data: null,
          error: (data as { error?: string })?.error ?? response.statusText,
          status: response.status,
        };
      }

      return { data, error: null, status: response.status };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : "Request failed",
        status: 0,
      };
    }
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    delete: <T>(path: string) => request<T>("DELETE", path),
    setToken: (newToken: string) => {
      config.token = newToken;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
