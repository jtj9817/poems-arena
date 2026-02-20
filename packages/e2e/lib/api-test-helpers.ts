const API_PORT = Number(process.env.API_PORT ?? 4000);

export const API_BASE_URL = `http://localhost:${API_PORT}`;
export const API_V1_URL = `${API_BASE_URL}/api/v1`;

/**
 * Makes a GET request to the API and returns the parsed JSON.
 */
export async function apiGet<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_V1_URL}${path}`);
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

/**
 * Makes a POST request to the API with JSON body and returns parsed JSON.
 */
export async function apiPost<T>(
  path: string,
  payload: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_V1_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

/**
 * Makes a GET request to the API root (non-versioned).
 */
export async function apiRootGet<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  const body = (await res.json()) as T;
  return { status: res.status, body };
}
