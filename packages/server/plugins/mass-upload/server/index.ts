import type { PluginAPI } from "../../../src/plugins/types.js";

let pluginApi: PluginAPI;

export function activate(api: PluginAPI): void {
  pluginApi = api;
  api.log.info("Mass Upload plugin activated");
}

export function deactivate(): void {
  pluginApi.log.info("Mass Upload plugin deactivated");
}
