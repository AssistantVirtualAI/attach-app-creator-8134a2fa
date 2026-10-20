import { useMemo, useState } from "react";
import type { PortalActivity } from "./lemtelHostedApi";
import type { LemtelDict } from "./lemtelI18n";

/** Organization activity: who did what to whom, with text search and an action filter (all client-side). */
export function ActivityLog({ t, items }: { t: LemtelDict; items: PortalActivity[] }) {
  const [text, setText] = useState("");
  const [action, setAction] = useState("");
  const label = (key: string) => t.activityActions[key] ?? key;
  const actions = useMemo(() => [...new Set(items.map((item) => item.action))].sort((a, b) => label(a).localeCompare(label(b))), [items]);
  const list = items.filter((item) => (!action || item.action === action) && (!text || `${label(item.action)} ${item.actor?.name ?? ""} ${item.actor?.email ?? ""} ${item.subject?.name ?? ""} ${item.subject?.email ?? ""}`.toLowerCase().includes(text.toLowerCase())));
  return <>
    <div className="flex flex-wrap gap-2 mb-4">
      <input aria-label={t.activityLog.search} placeholder={t.activityLog.search} className="lt-input !py-2 max-w-xs" value={text} onChange={(event) => setText(event.target.value)} />
      <select aria-label={t.activityLog.filter} className="lt-input !w-auto !py-2" value={action} onChange={(event) => setAction(event.target.value)}><option value="">{t.activityLog.allActions}</option>{actions.map((key) => <option key={key} value={key}>{label(key)}</option>)}</select>
      <span className="lt-chip self-center">{list.length}</span>
    </div>
    <ol className="lt-card p-6 space-y-4">{list.map((item) => <li key={item.id} className="flex gap-3"><span className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ background: "hsl(var(--lt-cyan))" }} /><div className="min-w-0">
      <p className="text-sm font-medium">{label(item.action)}</p>
      {item.actor || item.subject ? <p className="text-xs lt-ink-2 break-all">{item.actor ? `${t.activityLog.by} ${item.actor.name}` : ""}{item.actor && item.subject ? " · " : ""}{item.subject ? `${t.activityLog.concerning} ${item.subject.name}${item.subject.email && item.subject.email !== item.subject.name ? ` (${item.subject.email})` : ""}` : ""}</p> : null}
      <time className="lt-ink-2 text-xs" dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
    </div></li>)}</ol>
  </>;
}
