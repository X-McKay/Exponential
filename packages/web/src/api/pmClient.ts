import { request } from "./client.ts";
export { ApiRequestError as PmApiError } from "./client.ts";
export const pmApi = {
  assignments: <T = unknown>() => request<T>("GET", "/api/pm/assignments"),
  createAssignment: <T = unknown>(body: unknown) => request<T>("POST", "/api/pm/assignments", body),
  updateAssignment: <T = unknown>(id: string, body: unknown) => request<T>("PUT", `/api/pm/assignments/${encodeURIComponent(id)}`, body),
  runs: <T = unknown>(id: string) => request<T>("GET", `/api/pm/assignments/${encodeURIComponent(id)}/runs`),
  run: <T = unknown>(id: string, body: unknown = {}) => request<T>("POST", `/api/pm/assignments/${encodeURIComponent(id)}/run`, body),
};
