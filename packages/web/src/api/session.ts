import type { WorkspaceRole } from "@valueflow/domain";

export const sessionHeaders = (): Record<string, string> => {
  if (typeof sessionStorage === "undefined") return {};
  const user = sessionStorage.getItem("valueflow.user");
  const role = sessionStorage.getItem("valueflow.role");
  return { ...(user ? { "x-valueflow-user": user } : {}), ...(role ? { "x-valueflow-role": role } : {}) };
};
export const selectSession = (user: string, role: WorkspaceRole): void => {
  sessionStorage.setItem("valueflow.user", user);
  sessionStorage.setItem("valueflow.role", role);
  // Reset local caches, drafts, live subscriptions and pending responses at the identity boundary.
  window.location.reload();
};

export const sessionRole = (): WorkspaceRole => {
  const role = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem("valueflow.role");
  return role === "viewer" || role === "editor" ? role : "admin";
};
