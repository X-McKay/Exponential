/** Small, bounded client for the PM workspace endpoints. */
export interface PmRequestError { error: string; issues?: unknown }

export class PmApiError extends Error {
  constructor(public status: number, message: string, public issues?: unknown) { super(message); }
}

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let payload: PmRequestError = { error: `${response.status} ${response.statusText}` };
    try { payload = (await response.json()) as PmRequestError; } catch { /* text errors keep the status */ }
    throw new PmApiError(response.status, payload.error, payload.issues);
  }
  return (await response.json()) as T;
};

export const pmApi = {
  assignments: <T = unknown>() => request<T>("GET", "/api/pm/assignments"),
  createAssignment: <T = unknown>(body: unknown) => request<T>("POST", "/api/pm/assignments", body),
  updateAssignment: <T = unknown>(id: string, body: unknown) => request<T>("PUT", `/api/pm/assignments/${encodeURIComponent(id)}`, body),
  runs: <T = unknown>(id: string) => request<T>("GET", `/api/pm/assignments/${encodeURIComponent(id)}/runs`),
  run: <T = unknown>(id: string, body: unknown = {}) => request<T>("POST", `/api/pm/assignments/${encodeURIComponent(id)}/run`, body),
};
