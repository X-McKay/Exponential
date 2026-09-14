import type { CommsArtifact, CommsAssignment, CommsAssignmentUpdate, CommsRun, CommsWorkspaceDetail } from "@valueflow/shared";

export class CommsApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try { const payload = (await response.json()) as { error?: string }; detail = payload.error ?? detail; } catch { /* preserve status */ }
    throw new CommsApiError(response.status, detail);
  }
  return (await response.json()) as T;
};

export const commsApi = {
  assignments: () => request<CommsAssignment[]>("GET", "/api/comms/assignments"),
  detail: (id: string) => request<CommsWorkspaceDetail>("GET", `/api/comms/assignments/${encodeURIComponent(id)}`),
  createAssignment: (body: unknown) => request<CommsAssignment>("POST", "/api/comms/assignments", body),
  updateAssignment: (id: string, body: CommsAssignmentUpdate) => request<CommsAssignment>("PUT", `/api/comms/assignments/${encodeURIComponent(id)}`, body),
  run: (id: string, instruction?: string, mode: "draft" | "conversation" = "draft") => request<CommsRun>("POST", `/api/comms/assignments/${encodeURIComponent(id)}/run`, { ...(instruction ? { instruction } : {}), mode }),
  artifacts: (projectId: string) => request<CommsArtifact[]>("GET", `/api/comms/artifacts?projectId=${encodeURIComponent(projectId)}`),
  updateArtifact: (id: string, status: "approved" | "draft") => request<CommsArtifact>("PUT", `/api/comms/artifacts/${encodeURIComponent(id)}`, { status }),
  downloadUrl: (id: string, format: "md" | "txt") => `/api/comms/artifacts/${encodeURIComponent(id)}/download?format=${format}`,
};
