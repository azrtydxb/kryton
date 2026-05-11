import { useState, useEffect, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import {
  Search, Package, Download, RefreshCw, Trash2, Settings,
  CheckCircle, XCircle, AlertCircle, ChevronRight, ChevronDown,
  ToggleLeft, ToggleRight, Tag, X, Save, RotateCcw,
} from 'lucide-react';
import { api, RegistryPlugin, PluginUpdate } from '../lib/api';

/* ─────────────────────────── types ─────────────────────────── */

interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  state: 'active' | 'disabled' | 'error' | 'unloaded';
  error?: string | null;
  settings: SettingDecl[];
}

interface SettingDecl {
  key: string;
  type: 'string' | 'boolean' | 'number';
  default: unknown;
  label: string;
  perUser: boolean;
}

// Kryton app version — bump here when the server version changes (currently v3.2.0)
const KRYTON_VERSION = '3.2.0';

function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

/* ─────────────────────────── shared styles ─────────────────────────── */

const surfaceBox: CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line)',
};

const inputStyle: CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line)',
  color: 'var(--fg)',
};

const tabActiveStyle: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--accent-fg)',
};

const tabInactiveStyle: CSSProperties = {
  background: 'var(--bg-2)',
  color: 'var(--fg-3)',
  borderColor: 'var(--line)',
};

/* ═══════════════════════════════════════════════════════════════
   Main PluginsTab — sub-view switcher
═══════════════════════════════════════════════════════════════ */

type SubView = 'browse' | 'installed';

export function PluginsTab() {
  const [subView, setSubView] = useState<SubView>('installed');
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());

  const refreshInstalledIds = useCallback(() => {
    api.getAllPlugins()
      .then(data => setInstalledIds(new Set((data as InstalledPlugin[]).map(p => p.id))))
      .catch(() => { /* non-fatal */ });
  }, []);

  useEffect(() => { refreshInstalledIds(); }, [refreshInstalledIds]);

  return (
    <div>
      {/* Sub-view toggle */}
      <div className="flex gap-2 mb-6">
        <TabButton
          active={subView === 'installed'}
          onClick={() => setSubView('installed')}
          label="Installed"
        />
        <TabButton
          active={subView === 'browse'}
          onClick={() => setSubView('browse')}
          label="Browse Registry"
        />
      </div>

      {subView === 'browse' && (
        <RegistryBrowse
          installedIds={installedIds}
          onInstalled={refreshInstalledIds}
        />
      )}
      {subView === 'installed' && (
        <InstalledPlugins onUninstalled={refreshInstalledIds} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  const [hovered, setHovered] = useState(false);
  const style: CSSProperties = active
    ? tabActiveStyle
    : { ...tabInactiveStyle, color: hovered ? 'var(--fg)' : 'var(--fg-3)' };
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${active ? '' : 'border'}`}
      style={style}
    >
      {label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Registry Browse
═══════════════════════════════════════════════════════════════ */

function RegistryBrowse({
  installedIds,
  onInstalled,
}: {
  installedIds: Set<string>;
  onInstalled: () => void;
}) {
  const [registry, setRegistry] = useState<RegistryPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [installError, setInstallError] = useState<Record<string, string>>({});
  const [searchFocused, setSearchFocused] = useState(false);
  const [clearHovered, setClearHovered] = useState(false);

  const fetchRegistry = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api.getRegistry();
      setRegistry(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load registry');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRegistry(); }, [fetchRegistry]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    registry.forEach(p => p.tags.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [registry]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return registry.filter(p => {
      const matchesQuery =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q);
      const matchesTag = !activeTag || p.tags.includes(activeTag);
      return matchesQuery && matchesTag;
    });
  }, [registry, query, activeTag]);

  const install = async (id: string) => {
    setInstalling(prev => new Set(prev).add(id));
    setInstallError(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      await api.installPlugin(id);
      onInstalled();
    } catch (err) {
      setInstallError(prev => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Install failed',
      }));
    } finally {
      setInstalling(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="h-24 rounded-lg animate-pulse border"
            style={surfaceBox}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="px-4 py-3 border rounded-lg text-sm flex items-center justify-between"
        style={{ background: 'color-mix(in oklch, var(--accent-danger) 10%, transparent)', borderColor: 'color-mix(in oklch, var(--accent-danger) 30%, transparent)', color: 'var(--accent-danger)' }}
      >
        <span>{error}</span>
        <button onClick={fetchRegistry} className="ml-3 underline text-xs" style={{ color: 'var(--accent-danger)' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Search + tag filters */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--fg-3)' }}
          />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search plugins..."
            className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none transition-colors"
            style={{
              ...inputStyle,
              borderColor: searchFocused ? 'var(--accent)' : 'var(--line)',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              onMouseEnter={() => setClearHovered(true)}
              onMouseLeave={() => setClearHovered(false)}
              className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
              style={{ color: clearHovered ? 'var(--fg)' : 'var(--fg-3)' }}
            >
              <X size={13} />
            </button>
          )}
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {allTags.map(tag => (
              <TagChip
                key={tag}
                tag={tag}
                active={activeTag === tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Plugin cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--fg-4)' }}>
          No plugins match your search.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(plugin => {
            const isInstalled = installedIds.has(plugin.id);
            const isInstalling = installing.has(plugin.id);
            const err = installError[plugin.id];
            const incompatible = semverGt(plugin.minKrytonVersion, KRYTON_VERSION);

            return (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                isInstalled={isInstalled}
                isInstalling={isInstalling}
                err={err}
                incompatible={incompatible}
                onInstall={() => install(plugin.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TagChip({
  tag,
  active,
  onClick,
}: {
  tag: string;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const baseClass = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border';
  const style: CSSProperties = active
    ? {
      background: 'var(--accent-soft)',
      color: 'var(--accent)',
      borderColor: 'var(--accent)',
    }
    : {
      background: 'var(--bg-2)',
      color: hovered ? 'var(--fg)' : 'var(--fg-3)',
      borderColor: hovered ? 'var(--line-strong)' : 'var(--line)',
    };
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={baseClass}
      style={style}
    >
      <Tag size={10} />
      {tag}
    </button>
  );
}

function PluginCard({
  plugin,
  isInstalled,
  isInstalling,
  err,
  incompatible,
  onInstall,
}: {
  plugin: RegistryPlugin;
  isInstalled: boolean;
  isInstalling: boolean;
  err?: string;
  incompatible: boolean;
  onInstall: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-start justify-between px-4 py-4 rounded-lg border transition-colors"
      style={{
        background: 'var(--bg-2)',
        borderColor: hovered ? 'var(--line-strong)' : 'var(--line)',
      }}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div
          className="mt-0.5 p-2 rounded-lg shrink-0"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <Package size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{plugin.name}</span>
            <span className="text-xs" style={{ color: 'var(--fg-4)' }}>v{plugin.version}</span>
            <span className="text-xs" style={{ color: 'var(--fg-4)' }}>by {plugin.author}</span>
            {isInstalled && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ background: 'color-mix(in oklch, var(--accent-good) 20%, transparent)', color: 'var(--accent-good)' }}
              >
                <CheckCircle size={10} />
                Installed
              </span>
            )}
            {incompatible && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ background: 'color-mix(in oklch, var(--accent-warn) 20%, transparent)', color: 'var(--accent-warn)' }}
              >
                <AlertCircle size={10} />
                Requires v{plugin.minKrytonVersion}
              </span>
            )}
          </div>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--fg-3)' }}>{plugin.description}</p>
          {plugin.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {plugin.tags.map(tag => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded text-xs"
                  style={{ background: 'var(--bg-2)', color: 'var(--fg-3)' }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {err && (
            <p className="text-xs mt-1" style={{ color: 'var(--accent-danger)' }}>{err}</p>
          )}
        </div>
      </div>
      <div className="ml-4 shrink-0">
        {!isInstalled && (
          <InstallButton
            onClick={onInstall}
            disabled={isInstalling || incompatible}
            label={isInstalling ? 'Installing...' : 'Install'}
          />
        )}
      </div>
    </div>
  );
}

function InstallButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
    >
      <Download size={13} />
      {label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Installed Plugins
═══════════════════════════════════════════════════════════════ */

function InstalledPlugins({ onUninstalled }: { onUninstalled: () => void }) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [updates, setUpdates] = useState<PluginUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [settingsPlugin, setSettingsPlugin] = useState<InstalledPlugin | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [pluginData, updateData] = await Promise.all([
        api.getAllPlugins() as Promise<InstalledPlugin[]>,
        api.checkPluginUpdates().catch(() => [] as PluginUpdate[]),
      ]);
      setPlugins(pluginData);
      setUpdates(updateData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plugins');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const doAction = async (
    id: string,
    label: string,
    fn: () => Promise<unknown>,
  ) => {
    setActionLoading(prev => ({ ...prev, [id]: label }));
    setActionError(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      await fn();
      await fetchAll();
    } catch (err) {
      setActionError(prev => ({
        ...prev,
        [id]: err instanceof Error ? err.message : `${label} failed`,
      }));
    } finally {
      setActionLoading(prev => { const n = { ...prev }; delete n[id]; return n; });
    }
  };

  const uninstall = async (id: string) => {
    setConfirmUninstall(null);
    await doAction(id, 'Uninstalling', () => api.uninstallPlugin(id));
    onUninstalled();
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => (
          <div
            key={i}
            className="h-20 rounded-lg animate-pulse border"
            style={surfaceBox}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="px-4 py-3 border rounded-lg text-sm flex items-center justify-between"
        style={{ background: 'color-mix(in oklch, var(--accent-danger) 10%, transparent)', borderColor: 'color-mix(in oklch, var(--accent-danger) 30%, transparent)', color: 'var(--accent-danger)' }}
      >
        <span>{error}</span>
        <button onClick={fetchAll} className="ml-3 underline text-xs" style={{ color: 'var(--accent-danger)' }}>
          Retry
        </button>
      </div>
    );
  }

  if (plugins.length === 0) {
    return (
      <div className="text-center py-12 text-sm" style={{ color: 'var(--fg-4)' }}>
        No plugins installed yet. Browse the registry to find plugins.
      </div>
    );
  }

  return (
    <div>
      {settingsPlugin && (
        <PluginSettingsPanel
          plugin={settingsPlugin}
          onClose={() => setSettingsPlugin(null)}
        />
      )}

      <div className="space-y-3">
        {plugins.map(plugin => {
          const update = updates.find(u => u.id === plugin.id);
          const busy = actionLoading[plugin.id];
          const err = actionError[plugin.id];
          const isActive = plugin.state === 'active';
          const isDisabled = plugin.state === 'disabled' || plugin.state === 'unloaded';
          const isError = plugin.state === 'error';

          return (
            <div
              key={plugin.id}
              className="px-4 py-4 rounded-lg border"
              style={surfaceBox}
            >
              <div className="flex items-start justify-between gap-3">
                {/* Left: status dot + info */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="mt-1 shrink-0">
                    <StatusDot state={plugin.state} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{plugin.name}</span>
                      <span className="text-xs" style={{ color: 'var(--fg-4)' }}>v{plugin.version}</span>
                      <span className="text-xs" style={{ color: 'var(--fg-4)' }}>by {plugin.author}</span>
                      <StateLabel state={plugin.state} />
                      {update && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: 'color-mix(in oklch, var(--accent-warn) 20%, transparent)', color: 'var(--accent-warn)' }}
                        >
                          <AlertCircle size={10} />
                          v{update.latestVersion} available
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--fg-3)' }}>{plugin.description}</p>
                    {isError && plugin.error && (
                      <p className="text-xs mt-1 font-mono" style={{ color: 'var(--accent-danger)' }}>{plugin.error}</p>
                    )}
                    {err && (
                      <p className="text-xs mt-1" style={{ color: 'var(--accent-danger)' }}>{err}</p>
                    )}
                    {busy && (
                      <p className="text-xs mt-1" style={{ color: 'var(--fg-4)' }}>{busy}...</p>
                    )}
                  </div>
                </div>

                {/* Right: action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Settings (only if plugin has settings) */}
                  {plugin.settings && plugin.settings.length > 0 && (
                    <IconActionButton
                      onClick={() => setSettingsPlugin(plugin)}
                      title="Plugin settings"
                      icon={<Settings size={15} />}
                    />
                  )}

                  {/* Enable / Disable toggle */}
                  {isDisabled ? (
                    <button
                      onClick={() => doAction(plugin.id, 'Enabling', () => api.enablePlugin(plugin.id))}
                      disabled={!!busy}
                      className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                      style={{ color: 'var(--accent-good)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in oklch, var(--accent-good) 10%, transparent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      title="Enable plugin"
                    >
                      <ToggleLeft size={15} />
                    </button>
                  ) : (
                    <DisableButton
                      onClick={() => doAction(plugin.id, 'Disabling', () => api.disablePlugin(plugin.id))}
                      disabled={!!busy}
                    />
                  )}

                  {/* Reload */}
                  {isActive && (
                    <ReloadButton
                      onClick={() => doAction(plugin.id, 'Reloading', () => api.reloadPlugin(plugin.id))}
                      disabled={!!busy}
                    />
                  )}

                  {/* Update */}
                  {update && (
                    <button
                      onClick={() => doAction(plugin.id, 'Updating', () => api.updatePlugin(plugin.id))}
                      disabled={!!busy}
                      className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                      style={{ color: 'var(--accent-warn)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in oklch, var(--accent-warn) 10%, transparent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      title={`Update to v${update.latestVersion}`}
                    >
                      <RefreshCw size={15} />
                    </button>
                  )}

                  {/* Uninstall */}
                  {confirmUninstall === plugin.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => uninstall(plugin.id)}
                        className="px-2 py-1 rounded text-xs transition-colors"
                        style={{ background: 'var(--accent-danger)', color: 'var(--fg)' }}
                      >
                        Confirm
                      </button>
                      <CancelButton onClick={() => setConfirmUninstall(null)} />
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmUninstall(plugin.id)}
                      disabled={!!busy}
                      className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                      style={{ color: 'var(--accent-danger)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in oklch, var(--accent-danger) 10%, transparent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      title="Uninstall plugin"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IconActionButton({
  onClick,
  title,
  icon,
}: {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="p-1.5 rounded-lg transition-colors"
      title={title}
      style={{
        color: hovered ? 'var(--fg)' : 'var(--fg-3)',
        background: hovered ? 'var(--bg-hover)' : 'transparent',
      }}
    >
      {icon}
    </button>
  );
}

function DisableButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={disabled}
      className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
      title="Disable plugin"
      style={{
        color: hovered ? 'var(--accent-warn)' : 'var(--fg-3)',
        background: hovered ? 'color-mix(in oklch, var(--accent-warn) 10%, transparent)' : 'transparent',
      }}
    >
      <ToggleRight size={15} />
    </button>
  );
}

function ReloadButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={disabled}
      className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
      title="Reload plugin"
      style={{
        color: hovered ? 'var(--accent)' : 'var(--fg-3)',
        background: hovered ? 'var(--accent-soft)' : 'transparent',
      }}
    >
      <RotateCcw size={15} />
    </button>
  );
}

function CancelButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="px-2 py-1 rounded text-xs transition-colors"
      style={{ color: hovered ? 'var(--fg)' : 'var(--fg-3)' }}
    >
      Cancel
    </button>
  );
}

/* ─── Status dot ─── */

function StatusDot({ state }: { state: InstalledPlugin['state'] }) {
  if (state === 'active') {
    return <span className="inline-block w-2 h-2 rounded-full mt-1" style={{ background: 'var(--accent-good)' }} />;
  }
  if (state === 'error') {
    return <span className="inline-block w-2 h-2 rounded-full mt-1" style={{ background: 'var(--accent-danger)' }} />;
  }
  return (
    <span
      className="inline-block w-2 h-2 rounded-full mt-1"
      style={{ background: 'var(--fg-4)' }}
    />
  );
}

function StateLabel({ state }: { state: InstalledPlugin['state'] }) {
  if (state === 'active') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: 'color-mix(in oklch, var(--accent-good) 20%, transparent)', color: 'var(--accent-good)' }}
      >
        <CheckCircle size={10} />
        Active
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: 'color-mix(in oklch, var(--accent-danger) 20%, transparent)', color: 'var(--accent-danger)' }}
      >
        <XCircle size={10} />
        Error
      </span>
    );
  }
  if (state === 'disabled' || state === 'unloaded') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: 'var(--bg-2)', color: 'var(--fg-3)' }}
      >
        Disabled
      </span>
    );
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   Plugin Settings Panel
═══════════════════════════════════════════════════════════════ */

function PluginSettingsPanel({
  plugin,
  onClose,
}: {
  plugin: InstalledPlugin;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [headerHovered, setHeaderHovered] = useState(false);
  const [closeHovered, setCloseHovered] = useState(false);

  const adminSettings = plugin.settings.filter(s => !s.perUser);
  const userSettings = plugin.settings.filter(s => s.perUser);

  // Load current settings from the global settings store
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const all = await api.getSettings();
        const initial: Record<string, unknown> = {};
        plugin.settings.forEach(s => {
          const key = `plugin:${plugin.id}:${s.key}`;
          initial[s.key] = key in all ? all[key] : s.default;
        });
        setValues(initial);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, [plugin]);

  const setValue = (key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    try {
      setSaving(true);
      setError('');
      await Promise.all(
        plugin.settings.map(s => {
          const key = `plugin:${plugin.id}:${s.key}`;
          const val = values[s.key] ?? s.default;
          return api.updateSetting(key, String(val));
        }),
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mb-4 rounded-lg border"
      style={{ borderColor: 'var(--accent)', background: 'var(--accent-soft)' }}
    >
      {/* Panel header */}
      <button
        onClick={() => setExpanded(v => !v)}
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors"
        style={{ color: headerHovered ? 'var(--fg)' : 'var(--accent)' }}
      >
        <div className="flex items-center gap-2">
          <Settings size={15} />
          Settings — {plugin.name}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); onClose(); }}
            onMouseEnter={() => setCloseHovered(true)}
            onMouseLeave={() => setCloseHovered(false)}
            className="p-0.5 rounded transition-colors"
            style={{ color: closeHovered ? 'var(--fg)' : 'var(--fg-3)' }}
          >
            <X size={14} />
          </button>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {error && (
            <div
              className="mb-3 px-3 py-2 border rounded-lg text-xs"
              style={{ background: 'color-mix(in oklch, var(--accent-danger) 10%, transparent)', borderColor: 'color-mix(in oklch, var(--accent-danger) 30%, transparent)', color: 'var(--accent-danger)' }}
            >
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-sm py-2" style={{ color: 'var(--fg-3)' }}>Loading settings...</div>
          ) : (
            <>
              {adminSettings.length > 0 && (
                <SettingsGroup
                  title="Admin Settings"
                  subtitle="Server-wide defaults"
                  settings={adminSettings}
                  values={values}
                  onChange={setValue}
                />
              )}
              {userSettings.length > 0 && (
                <SettingsGroup
                  title="Per-User Defaults"
                  subtitle="Users can override these in their own settings"
                  settings={userSettings}
                  values={values}
                  onChange={setValue}
                />
              )}

              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  <Save size={14} />
                  {saving ? 'Saving...' : 'Save'}
                </button>
                {saved && (
                  <span className="text-xs flex items-center gap-1" style={{ color: 'var(--accent-good)' }}>
                    <CheckCircle size={12} /> Saved
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsGroup({
  title,
  subtitle,
  settings,
  values,
  onChange,
}: {
  title: string;
  subtitle: string;
  settings: SettingDecl[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="mb-4">
      <div className="mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--fg)' }}>{title}</p>
        <p className="text-xs" style={{ color: 'var(--fg-4)' }}>{subtitle}</p>
      </div>
      <div className="space-y-3">
        {settings.map(s => (
          <SettingField key={s.key} decl={s} value={values[s.key]} onChange={v => onChange(s.key, v)} />
        ))}
      </div>
    </div>
  );
}

function SettingField({
  decl,
  value,
  onChange,
}: {
  decl: SettingDecl;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [focused, setFocused] = useState(false);
  const inputClass = 'border rounded-lg px-3 py-1.5 text-sm focus:outline-none transition-colors';
  const inputDynamicStyle: CSSProperties = {
    ...inputStyle,
    borderColor: focused ? 'var(--accent)' : 'var(--line)',
  };

  if (decl.type === 'boolean') {
    const checked = Boolean(value);
    return (
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <span className="text-sm" style={{ color: 'var(--fg)' }}>{decl.label}</span>
        <button
          onClick={() => onChange(!checked)}
          className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
          style={{ background: checked ? 'var(--accent)' : 'var(--fg-4)' }}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full transform transition-transform ${
              checked ? 'translate-x-4' : 'translate-x-0.5'
            }`}
            style={{ background: 'var(--fg)' }}
          />
        </button>
      </label>
    );
  }

  if (decl.type === 'number') {
    return (
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm" style={{ color: 'var(--fg)' }}>{decl.label}</label>
        <input
          type="number"
          value={value as number ?? 0}
          onChange={e => onChange(Number(e.target.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={`w-28 text-right ${inputClass}`}
          style={inputDynamicStyle}
        />
      </div>
    );
  }

  // string (default)
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm" style={{ color: 'var(--fg)' }}>{decl.label}</label>
      <input
        type="text"
        value={value as string ?? ''}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`w-full ${inputClass}`}
        style={inputDynamicStyle}
      />
    </div>
  );
}
