import { Quantum } from "ldrs/react";
import "ldrs/react/Quantum.css";
import "./AgentRunIndicator.css";

/** A real running state; queued/waiting states should use a static label instead. */
export function AgentRunIndicator({ running, size = 24, label = "Running" }: { running: boolean; size?: number; label?: string }) {
  if (!running) return null;
  return <span className="vf-agent-running" role="status" aria-label={label}>
    <span className="vf-agent-quantum" aria-hidden="true"><Quantum size={size} speed={1.75} color="currentColor" /></span>
    <span className="vf-agent-static" aria-hidden="true">●</span>
  </span>;
}

export function AgentDraftPlaceholder({ label = "Preparing assessment" }: { label?: string }) {
  return <div className="vf-agent-draft" role="status" aria-label={label}>
    <span>{label}</span>
    <span className="vf-agent-skeleton" aria-hidden="true" />
    <span className="vf-agent-skeleton vf-agent-skeleton-short" aria-hidden="true" />
  </div>;
}
