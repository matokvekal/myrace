/**
 * Cheap, firebase-free entry point — safe to import statically from anywhere
 * (including eager, non-lazy files like usePwaInstall/App.tsx) because it
 * carries no heavy SDK import itself. The actual Firebase Analytics module
 * only loads via dynamic `import()`, and only when configured.
 */
import { isAnalyticsConfigured } from "./analyticsConfig";

export function initAnalytics(): void {
  if (!isAnalyticsConfigured()) return;
  void import("./analytics").then((m) => m.initAnalytics());
}

export function logAnalyticsEvent(name: string, params?: Record<string, unknown>): void {
  if (!isAnalyticsConfigured()) return;
  void import("./analytics").then((m) => m.logAnalyticsEvent(name, params));
}
