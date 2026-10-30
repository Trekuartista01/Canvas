export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "just now" / "5m ago" / "3h ago" / "2d ago", falling back to a locale date beyond a week. */
export function formatRelativeTime(date: Date, now = new Date()): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

interface AutomationRunLogEntry {
  action: "set_priority" | "add_tag" | "post_comment" | "generate_image" | "slack_notify";
  ok: boolean;
  detail?: unknown;
  error?: string;
}

/**
 * One plain-English line per automation action, replacing a raw JSON dump —
 * the automations editor's run history is the only place this log is shown,
 * and nobody reading it wants `{"action":"set_priority","ok":true,...}`.
 */
export function describeAutomationRunLogEntry(entry: AutomationRunLogEntry): string {
  if (!entry.ok) {
    const what =
      entry.action === "set_priority"
        ? "Setting the priority"
        : entry.action === "add_tag"
          ? "Adding a tag"
          : entry.action === "post_comment"
            ? "Posting a comment"
            : entry.action === "generate_image"
              ? "Generating an image"
              : "Sending a Slack message";
    return `${what} failed${entry.error ? `: ${entry.error}` : ""}`;
  }
  switch (entry.action) {
    case "set_priority":
      return "Set the priority";
    case "add_tag":
      return "Added a tag";
    case "post_comment":
      return "Posted a comment";
    case "generate_image":
      return "Started generating an image";
    case "slack_notify":
      return "Sent a Slack message";
  }
}

/**
 * M7.2: "12 Mar" or "12 Mar, 14:30" — the due date plus its optional time
 * (Kosovo wall-clock time, shown as stored).
 */
export function formatDue(dueDate: string | null, dueTime?: string | null): string | null {
  if (!dueDate) return null;
  const date = new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  return dueTime ? `${date}, ${dueTime.slice(0, 5)}` : date;
}
