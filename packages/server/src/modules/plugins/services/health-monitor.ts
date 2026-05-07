interface HealthMonitorOptions {
  maxErrors: number;
  windowMs: number;
  onDisable: (pluginId: string) => void;
}

export class PluginHealthMonitor {
  private errors = new Map<string, number[]>();
  private disabled = new Set<string>();
  private options: HealthMonitorOptions;

  constructor(options: HealthMonitorOptions) {
    this.options = options;
  }

  recordError(pluginId: string): void {
    if (this.disabled.has(pluginId)) return;

    const now = Date.now();
    const timestamps = this.errors.get(pluginId) || [];
    const cutoff = now - this.options.windowMs;
    const recent = timestamps.filter((t) => t > cutoff);
    recent.push(now);
    this.errors.set(pluginId, recent);

    if (recent.length >= this.options.maxErrors) {
      this.disabled.add(pluginId);
      this.options.onDisable(pluginId);
    }
  }

  reset(pluginId: string): void {
    this.errors.delete(pluginId);
    this.disabled.delete(pluginId);
  }
}
