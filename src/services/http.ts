/** Error raised when an Atlassian REST call fails. The message is safe to show to users. */
export class AtlassianApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ApiResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export async function readJson<T>(response: ApiResponse, what: string): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[ScopeGuard] ${what} failed: ${response.status} ${detail.slice(0, 300)}`);
    throw new AtlassianApiError(`Could not ${what} (HTTP ${response.status}).`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
