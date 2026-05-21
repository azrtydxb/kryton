import { useState, useEffect, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useMobileEmbed } from '../hooks/useMobileEmbed';
import '../styles/mobile-embed.css';
import {
  Search, Package, Download, RefreshCw, Trash2, Settings,
  CheckCircle, XCircle, AlertCircle,
  ToggleLeft, ToggleRight, Tag, X, Save, RotateCcw,
} from 'lucide-react';
import { api, RegistryPlugin, PluginUpdate } from '../lib/api';
import { Section, Field } from '../components/Settings/settings-kit';
import {
  helpText,
  inputStyle as kitInputStyle,
  primaryBtn,
  ghostBtn,
  dangerBtn,
} from '../components/Settings/settings-kit-styles';

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

const cardStyle: CSSProperties = {
  background: 'var(--bg-1)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '12px 14px',
  marginBottom: 8,
};

const errorBoxStyle: CSSProperties = {
  ...helpText,
  marginBottom: 12,
  padding: '8px 10px',
  borderRadius: 5,
  background: 'color-mix(in oklch, var(--accent-danger) 10%, transparent)',
  border: '1px solid color-mix(in oklch, var(--accent-danger) 30%, transparent)',
  color: 'var(--accent-danger)',
  fontFamily: 'var(--font-mono)',
};

const subTabStyle = (active: boolean): CSSProperties => ({
  padding: '6px 10px',
  borderRadius: 6,
  background: active ? 'var(--accent-soft)' : 'transparent',
  color: active ? 'var(--accent)' : 'var(--fg-3)',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  transition: 'background 120ms, color 120ms',
});

/* ═══════════════════════════════════════════════════════════════
   Main PluginsTab — sub-view switcher
═══════════════════════════════════════════════════════════════ */

type SubView = 'browse' | 'installed';

export function PluginsTab() {
  const isMobile = useMobileEmbed();
  const [subView, setSubView] = useState<SubView>('installed');
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());

  const refreshInstalledIds = useCallback(() => {
    api.getAllPlugins()
      .then(data => setInstalledIds(new Set((data as InstalledPlugin[]).map(p => p.id))))
      .catch(() => { /* non-fatal */ });
  }, []);

  useEffect(() => { refreshInstalledIds(); }, [refreshInstalledIds]);

  return (
    <div className={isMobile ? "mobile-embed" : ""} style={{ color: 'var(--fg-1)' }}>
      {/* Sub-view toggle — same mode-pill pattern as the outer tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 14 }}>
        <SubTabBtn active={subView === 'installed'} onClick={() => setSubView('installed')} label="Installed" />
        <SubTabBtn active={subView === 'browse'} onClick={() => setSubView('browse')} label="Browse Registry" />
      </div>

      {subView === 'browse' && (
        <RegistryBrowse installedIds={installedIds} onInstalled={refreshInstalledIds} />
      )}
      {subView === 'installed' && (
        <InstalledPlugins onUninstalled={refreshInstalledIds} />
      )}
    </div>
  );
}

function SubTabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={subTabStyle(active)}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = 'var(--bg-hover)';
          e.currentTarget.style.color = 'var(--fg)';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--fg-3)';
        }
      }}
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

  useEffect(() => {
    void (async () => {
      await fetchRegistry();
    })();
  }, [fetchRegistry]);

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

  const install = useCallback(async (id: string) => {
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
  }, [onInstalled]);

  if (error) {
    return (
      <div style={{ ...errorBoxStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{error}</span>
        <button onClick={fetchRegistry} style={{ ...ghostBtn, padding: '4px 8px' }}>Retry</button>
      </div>
    );
  }

  return (
    <Section title="browse registry">
      <div style={helpText}>Search and install plugins from the public registry.</div>

      <Field label="search">
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-3)' }} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search plugins..."
            style={{ ...kitInputStyle, paddingLeft: 30, paddingRight: query ? 30 : 10 }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'transparent', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', padding: 2,
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </Field>

      {allTags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
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

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ ...cardStyle, height: 72, opacity: 0.5 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={helpText}>No plugins match your search.</div>
      ) : (
        <div>
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
    </Section>
  );
}

function TagChip({ tag, active, onClick }: { tag: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border"
      style={active
        ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
        : { background: 'var(--bg-2)', color: 'var(--fg-3)', borderColor: 'var(--line)' }}
    >
      <Tag size={10} />
      {tag}
    </button>
  );
}

function PluginCard({
  plugin, isInstalled, isInstalling, err, incompatible, onInstall,
}: {
  plugin: RegistryPlugin;
  isInstalled: boolean;
  isInstalling: boolean;
  err?: string;
  incompatible: boolean;
  onInstall: () => void;
}) {
  return (
    <div style={{ ...cardStyle, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div
        style={{
          padding: 8, borderRadius: 6, background: 'var(--accent-soft)',
          color: 'var(--accent)', flexShrink: 0,
        }}
      >
        <Package size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg)', fontWeight: 500 }}>
            {plugin.name}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-4)' }}>v{plugin.version}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-4)' }}>by {plugin.author}</span>
          {isInstalled && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: 'color-mix(in oklch, var(--accent-good) 20%, transparent)', color: 'var(--accent-good)' }}
            >
              <CheckCircle size={10} /> Installed
            </span>
          )}
          {incompatible && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: 'color-mix(in oklch, var(--accent-warn) 20%, transparent)', color: 'var(--accent-warn)' }}
            >
              <AlertCircle size={10} /> Requires v{plugin.minKrytonVersion}
            </span>
          )}
        </div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', marginTop: 4, lineHeight: 1.5 }}>
          {plugin.description}
        </p>
        {plugin.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {plugin.tags.map(tag => (
              <span
                key={tag}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
                  borderRadius: 4, background: 'var(--bg-2)', color: 'var(--fg-3)',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {err && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-danger)', marginTop: 6 }}>{err}</p>}
      </div>
      <div style={{ flexShrink: 0 }}>
        {!isInstalled && (
          <button
            onClick={onInstall}
            disabled={isInstalling || incompatible}
            style={{
              ...primaryBtn,
              opacity: isInstalling || incompatible ? 0.5 : 1,
              cursor: isInstalling || incompatible ? 'not-allowed' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            <Download size={12} />
            {isInstalling ? 'Installing…' : 'Install'}
          </button>
        )}
      </div>
    </div>
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

  /**
   * Fetch the plugin list.
   *
   * `silent: true` skips the loading-skeleton toggle so the existing
   * list stays mounted while the new data lands. That's the refetch
   * path used by enable/disable/reload/uninstall — without it the
   * list area gets unmounted into a skeleton + remounted, which
   * resets the scroll container's scrollTop and bounces the user back
   * to the top whenever they act on a plugin further down the list.
   */
  const fetchAll = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchAll();
    })();
  }, [fetchAll]);

  const doAction = useCallback(async (
    id: string, label: string, fn: () => Promise<unknown>,
  ) => {
    setActionLoading(prev => ({ ...prev, [id]: label }));
    setActionError(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      await fn();
      // Silent refetch — the list stays mounted, so the user's scroll
      // position is preserved across an enable/disable/reload.
      await fetchAll(true);
    } catch (err) {
      setActionError(prev => ({
        ...prev,
        [id]: err instanceof Error ? err.message : `${label} failed`,
      }));
    } finally {
      setActionLoading(prev => { const n = { ...prev }; delete n[id]; return n; });
    }
  }, [fetchAll]);

  const uninstall = useCallback(async (id: string) => {
    setConfirmUninstall(null);
    await doAction(id, 'Uninstalling', () => api.uninstallPlugin(id));
    onUninstalled();
  }, [doAction, onUninstalled]);

  if (error) {
    return (
      <div style={{ ...errorBoxStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{error}</span>
        <button onClick={() => fetchAll()} style={{ ...ghostBtn, padding: '4px 8px' }}>Retry</button>
      </div>
    );
  }

  return (
    <Section title="installed plugins">
      <div style={helpText}>Manage plugins installed on this server — enable, disable, configure, or update them.</div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2].map(i => (
            <div key={i} style={{ ...cardStyle, height: 60, opacity: 0.5 }} />
          ))}
        </div>
      ) : plugins.length === 0 ? (
        <div style={helpText}>No plugins installed yet. Browse the registry to find plugins.</div>
      ) : (
        <div>
          {plugins.map(plugin => {
            const update = updates.find(u => u.id === plugin.id);
            const busy = actionLoading[plugin.id];
            const err = actionError[plugin.id];
            const isActive = plugin.state === 'active';
            const isDisabled = plugin.state === 'disabled' || plugin.state === 'unloaded';
            const isError = plugin.state === 'error';

            const settingsOpen = settingsPlugin?.id === plugin.id;
            return (
              <div key={plugin.id} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
                    <div style={{ marginTop: 4, flexShrink: 0 }}>
                      <StatusDot state={plugin.state} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg)', fontWeight: 500 }}>
                          {plugin.name}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-4)' }}>v{plugin.version}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-4)' }}>by {plugin.author}</span>
                        <StateLabel state={plugin.state} />
                        {update && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ background: 'color-mix(in oklch, var(--accent-warn) 20%, transparent)', color: 'var(--accent-warn)' }}
                          >
                            <AlertCircle size={10} /> v{update.latestVersion} available
                          </span>
                        )}
                      </div>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', marginTop: 2, lineHeight: 1.5 }}>
                        {plugin.description}
                      </p>
                      {isError && plugin.error && (
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-danger)', marginTop: 4 }}>{plugin.error}</p>
                      )}
                      {err && (
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-danger)', marginTop: 4 }}>{err}</p>
                      )}
                      {busy && (
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-4)', marginTop: 4 }}>{busy}…</p>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {plugin.settings && plugin.settings.length > 0 && (
                      <PluginIconBtn
                        onClick={() => setSettingsPlugin(settingsOpen ? null : plugin)}
                        title={settingsOpen ? 'Close settings' : 'Plugin settings'}
                        color={settingsOpen ? 'var(--accent)' : 'var(--fg-3)'}
                        icon={<Settings size={14} />}
                      />
                    )}
                    {isDisabled ? (
                      <PluginIconBtn
                        onClick={() => doAction(plugin.id, 'Enabling', () => api.enablePlugin(plugin.id))}
                        title="Enable plugin"
                        color="var(--accent-good)"
                        disabled={!!busy}
                        icon={<ToggleLeft size={14} />}
                      />
                    ) : (
                      <PluginIconBtn
                        onClick={() => doAction(plugin.id, 'Disabling', () => api.disablePlugin(plugin.id))}
                        title="Disable plugin"
                        color="var(--accent-warn)"
                        disabled={!!busy}
                        icon={<ToggleRight size={14} />}
                      />
                    )}
                    {isActive && (
                      <PluginIconBtn
                        onClick={() => doAction(plugin.id, 'Reloading', () => api.reloadPlugin(plugin.id))}
                        title="Reload plugin"
                        color="var(--accent)"
                        disabled={!!busy}
                        icon={<RotateCcw size={14} />}
                      />
                    )}
                    {update && (
                      <PluginIconBtn
                        onClick={() => doAction(plugin.id, 'Updating', () => api.updatePlugin(plugin.id))}
                        title={`Update to v${update.latestVersion}`}
                        color="var(--accent-warn)"
                        disabled={!!busy}
                        icon={<RefreshCw size={14} />}
                      />
                    )}
                    {confirmUninstall === plugin.id ? (
                      <>
                        <button onClick={() => uninstall(plugin.id)} style={dangerBtn}>Confirm</button>
                        <button onClick={() => setConfirmUninstall(null)} style={ghostBtn}>Cancel</button>
                      </>
                    ) : (
                      <PluginIconBtn
                        onClick={() => setConfirmUninstall(plugin.id)}
                        title="Uninstall plugin"
                        color="var(--accent-danger)"
                        disabled={!!busy}
                        icon={<Trash2 size={14} />}
                      />
                    )}
                  </div>
                </div>
                {settingsOpen && (
                  <PluginSettingsPanel
                    plugin={plugin}
                    onClose={() => setSettingsPlugin(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function PluginIconBtn({
  onClick, title, color, icon, disabled,
}: {
  onClick: () => void;
  title: string;
  color: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="p-1.5 rounded-lg transition-colors"
      style={{
        color, background: 'transparent', border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {icon}
    </button>
  );
}

/* ─── Status dot ─── */

function StatusDot({ state }: { state: InstalledPlugin['state'] }) {
  const colors: Record<InstalledPlugin['state'], string> = {
    active: 'var(--accent-good)',
    error: 'var(--accent-danger)',
    disabled: 'var(--fg-4)',
    unloaded: 'var(--fg-4)',
  };
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colors[state] }} />;
}

function StateLabel({ state }: { state: InstalledPlugin['state'] }) {
  if (state === 'active') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: 'color-mix(in oklch, var(--accent-good) 20%, transparent)', color: 'var(--accent-good)' }}
      >
        <CheckCircle size={10} /> Active
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: 'color-mix(in oklch, var(--accent-danger) 20%, transparent)', color: 'var(--accent-danger)' }}
      >
        <XCircle size={10} /> Error
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
}: {
  plugin: InstalledPlugin;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const adminSettings = plugin.settings.filter(s => !s.perUser);
  const userSettings = plugin.settings.filter(s => s.perUser);

  const loadValues = useCallback(async () => {
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
  }, [plugin]);

  useEffect(() => {
    void (async () => {
      await loadValues();
    })();
  }, [loadValues]);

  const setValue = (key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = useCallback(async () => {
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
  }, [plugin, values]);

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: '1px solid var(--line)',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 0 8px 0',
          color: 'var(--accent)',
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Settings size={12} />
          Settings
        </span>
      </div>

      <div style={{ padding: 0 }}>
          {error && <div style={errorBoxStyle}>{error}</div>}

          {loading ? (
            <div style={helpText}>Loading settings...</div>
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <button
                  onClick={save}
                  disabled={saving}
                  style={{
                    ...primaryBtn, opacity: saving ? 0.5 : 1,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <Save size={12} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {saved && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-good)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle size={12} /> Saved
                  </span>
                )}
              </div>
            </>
          )}
        </div>
    </div>
  );
}

function SettingsGroup({
  title, subtitle, settings, values, onChange,
}: {
  title: string;
  subtitle: string;
  settings: SettingDecl[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--fg)', fontWeight: 600,
        }}>
          {title}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-4)' }}>{subtitle}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {settings.map(s => (
          <SettingField key={s.key} decl={s} value={values[s.key]} onChange={v => onChange(s.key, v)} />
        ))}
      </div>
    </div>
  );
}

function SettingField({
  decl, value, onChange,
}: {
  decl: SettingDecl;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (decl.type === 'boolean') {
    const checked = Boolean(value);
    return (
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg)' }}>{decl.label}</span>
        <button
          onClick={() => onChange(!checked)}
          style={{
            position: 'relative', display: 'inline-flex', alignItems: 'center',
            height: 20, width: 36, borderRadius: 999, border: 'none',
            background: checked ? 'var(--accent)' : 'var(--fg-4)', cursor: 'pointer',
            transition: 'background 120ms',
          }}
        >
          <span
            style={{
              display: 'inline-block', height: 14, width: 14, borderRadius: '50%',
              background: 'var(--fg)',
              transform: checked ? 'translateX(18px)' : 'translateX(2px)',
              transition: 'transform 120ms',
            }}
          />
        </button>
      </label>
    );
  }

  if (decl.type === 'number') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <label style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg)' }}>{decl.label}</label>
        <input
          type="number"
          value={(value as number) ?? 0}
          onChange={e => onChange(Number(e.target.value))}
          style={{ ...kitInputStyle, width: 120, textAlign: 'right' }}
        />
      </div>
    );
  }

  return (
    <Field label={decl.label}>
      <input
        type="text"
        value={(value as string) ?? ''}
        onChange={e => onChange(e.target.value)}
        style={kitInputStyle}
      />
    </Field>
  );
}
