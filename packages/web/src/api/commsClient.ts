import type { CommsArtifact, CommsAssignment, CommsAssignmentUpdate, CommsRun, CommsWorkspaceDetail } from "@valueflow/shared";

import { request } from "./client.ts";
export { ApiRequestError as CommsApiError } from "./client.ts";

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
