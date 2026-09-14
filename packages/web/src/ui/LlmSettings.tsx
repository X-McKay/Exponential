import { useEffect, useState } from "react";
import type { LlmSettingsStatus } from "@valueflow/shared";
import { request } from "../api/client.ts";
import { Btn, inpStyle } from "./primitives.tsx";
import { C } from "../theme.ts";

export function LlmSettings() {
  const [settings, setSettings] = useState<LlmSettingsStatus | null>(null);
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { void request<LlmSettingsStatus>("GET", "/api/settings/llm").then(setSettings).catch(e => setError(e.message)); }, []);
  const save = async (test: boolean) => {
    if (!settings || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const next = await request<LlmSettingsStatus>("PUT", "/api/settings/llm", { ...settings, apiKey: token || undefined, clearToken });
      setSettings(next); setToken(""); setClearToken(false);
      if (test) {
        const result = await request<{ model: string }>("POST", "/api/settings/llm/test");
        setMessage(`Connected to ${result.model}. Close settings to start a project.`);
      } else setMessage("Saved. New runs use this configuration; active runs keep their original connection.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section style={{ display: "grid", gap: 10, marginTop: 20, borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
    <strong>LLM connection</strong>
    {error && <div role="alert" style={{ color: C.redHi }}>{error}</div>}
    {message && <div role="status" style={{ color: C.green }}>{message}</div>}
    {settings && <>
      <label><input type="checkbox" checked={settings.enabled} onChange={e => setSettings({ ...settings, enabled: e.target.checked })} /> Enable AI features</label>
      <label>API base URL<input aria-label="LLM API base URL" style={{ ...inpStyle, width: "100%" }} placeholder="https://your-provider.example/v1" value={settings.baseUrl} onChange={e => setSettings({ ...settings, baseUrl: e.target.value })} /></label>
      <label>Model name<input aria-label="LLM model name" style={{ ...inpStyle, width: "100%" }} placeholder="Model ID from your provider" value={settings.model} onChange={e => setSettings({ ...settings, model: e.target.value })} /></label>
      <label>API token<input aria-label="LLM API token" type="password" autoComplete="new-password" style={{ ...inpStyle, width: "100%" }} value={token} placeholder={settings.hasToken ? "Saved token • leave blank to retain" : "Optional for local providers"} onChange={e => setToken(e.target.value)} /></label>
      <label><input type="checkbox" checked={clearToken} onChange={e => setClearToken(e.target.checked)} /> Remove saved token</label>
      <label><input type="checkbox" checked={settings.thinking} onChange={e => setSettings({ ...settings, thinking: e.target.checked })} /> Enable model reasoning</label>
      <span style={{ color: C.dim, fontSize: 11 }}>Shared by the workspace. Tokens stay on the server and are never returned. Changing the endpoint requires a new token. Connection testing lists models without generating text.</span>
      <div style={{ display: "flex", gap: 8 }}><Btn disabled={busy || !settings.baseUrl || !settings.model} onClick={() => void save(false)}>Save connection</Btn><Btn tone="primary" disabled={busy || !settings.enabled || !settings.baseUrl || !settings.model} onClick={() => void save(true)}>{busy ? "Connecting…" : "Save and test connection"}</Btn></div>
    </>}
  </section>;
}
