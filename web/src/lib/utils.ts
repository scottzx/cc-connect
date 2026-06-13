import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatTime(iso: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

// Project names follow the `<workspaceSlug>__<agentType>` convention.
// The `__<agentType>` suffix is redundant with the agent-type badge shown
// alongside it, so strip it for display. Falls back to the raw name when the
// suffix doesn't match (legacy / manually-named projects).
export function projectDisplayName(name: string, agentType?: string): string {
  if (agentType && name.endsWith(`__${agentType}`)) {
    return name.slice(0, name.length - agentType.length - 2);
  }
  return name;
}
