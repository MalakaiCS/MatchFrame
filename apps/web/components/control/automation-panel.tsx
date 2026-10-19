'use client';
// Filled in by the automation milestone (queue, runs, skipped/preempted reasons).
export function AutomationPanel({ overlayId }: { overlayId: string }) {
  void overlayId;
  return <p className="text-xs text-muted">Automation is not configured for this output.</p>;
}
