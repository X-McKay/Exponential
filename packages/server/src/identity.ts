import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { WorkspaceMember, WorkspaceRole } from "@valueflow/domain";

// Explicitly self-selected identity for a trusted shared workspace, not authentication.
export const actorContext = new AsyncLocalStorage<WorkspaceMember | undefined>();
export const listMembers = (db: Database): WorkspaceMember[] => db.query<WorkspaceMember, []>("SELECT * FROM workspace_members ORDER BY rowid").all();
export const selectActor = (db: Database, req: Request): WorkspaceMember | undefined => {
  const id = req.headers.get("x-valueflow-user");
  const role = req.headers.get("x-valueflow-role");
  const members = listMembers(db);
  const member = id ? members.find(m => m.id === id) : members[0];
  if (id && !member) throw new Error("Unknown workspace user; select a user again.");
  if (role && !["admin", "editor", "viewer"].includes(role)) throw new Error("Unknown workspace role.");
  return member ? { ...member, role: (role ?? member.role) as WorkspaceRole } : undefined;
};
export const createMember = (db: Database, name: string, role: WorkspaceRole): WorkspaceMember => {
  const base = name.split(/\s+/).map(s => s[0]).join("").toUpperCase().slice(0, 2) || "U";
  const used = new Set(listMembers(db).map(m => m.ini));
  let ini = base;
  for (let n = 1; used.has(ini); n++) {
    if (n > 35) throw new Error("Choose a name with different initials.");
    ini = base + n.toString(36).toUpperCase();
  }
  const member = { id: randomUUID(), name, ini, role };
  db.query("INSERT INTO workspace_members (id,name,ini,role) VALUES (?,?,?,?)").run(member.id, name, ini, role);
  return member;
};
