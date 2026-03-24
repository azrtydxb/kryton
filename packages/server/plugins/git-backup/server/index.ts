import type { PluginAPI } from '../../../types/server';

// Declare require for Node built-ins — no @types/node in this project
declare function require(module: string): any;

type ExecFn = (
  cmd: string,
  opts: { cwd: string },
  cb: (err: Error | null, stdout: string, stderr: string) => void,
) => void;

const { exec } = require('child_process') as { exec: ExecFn };
const pathMod = require('path') as { resolve: (...parts: string[]) => string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a shell command in the given directory, returning stdout. */
function runGit(args: string, cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    exec(`git ${args}`, { cwd }, (err: Error | null, stdout: string, stderr: string) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/** Resolve the notes root directory from the plugin's dataDir.
 *
 * Convention: plugin data lives at <notesRoot>/.mnemo/plugins/<pluginId>/
 * We walk up three levels to reach the notes root.
 */
function resolveNotesDir(dataDir: string): string {
  return pathMod.resolve(dataDir, '..', '..', '..');
}

/** Replace {{date}} in a commit message template with the current ISO timestamp. */
function renderCommitMessage(template: string): string {
  return template.replace('{{date}}', new Date().toISOString());
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface BackupState {
  pendingCommit: boolean;
  intervalHandle: ReturnType<typeof setInterval> | null;
  lastCommitTime: Date | null;
  lastCommitHash: string | null;
}

const state: BackupState = {
  pendingCommit: false,
  intervalHandle: null,
  lastCommitTime: null,
  lastCommitHash: null,
};

// ---------------------------------------------------------------------------
// Core backup function
// ---------------------------------------------------------------------------

async function performCommit(notesDir: string, message: string, api: PluginAPI): Promise<void> {
  try {
    await runGit('add -A', notesDir);
    const statusOut = await runGit('status --porcelain', notesDir);
    if (!statusOut) {
      api.log.info('git-backup: nothing to commit');
      return;
    }
    await runGit(`commit -m "${message.replace(/"/g, '\\"')}"`, notesDir);
    state.lastCommitTime = new Date();
    const hash = await runGit('rev-parse --short HEAD', notesDir);
    state.lastCommitHash = hash;
    api.log.info(`git-backup: committed ${hash} — ${message}`);
    state.pendingCommit = false;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    api.log.error(`git-backup: commit failed — ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

export function activate(api: PluginAPI): void {
  api.log.info('Git Backup plugin activated');

  const notesDir = resolveNotesDir(api.plugin.dataDir);

  // Mark a commit as pending on every save
  api.events.on('note:afterSave', () => {
    state.pendingCommit = true;
  });

  // Populate last commit info on startup (best-effort)
  runGit('log -1 --format=%H %ci', notesDir)
    .then((out) => {
      if (out) {
        const spaceIdx = out.indexOf(' ');
        state.lastCommitHash = spaceIdx > 0 ? out.slice(0, spaceIdx) : out;
        const dateStr = spaceIdx > 0 ? out.slice(spaceIdx + 1).trim() : '';
        state.lastCommitTime = dateStr ? new Date(dateStr) : null;
      }
    })
    .catch(() => {
      // Not a git repo yet — fine
    });

  // Auto-commit interval — checked every minute
  async function maybeAutoCommit(): Promise<void> {
    if (!state.pendingCommit) return;
    const rawInterval = await api.settings.get('autoCommitInterval');
    const intervalMinutes = typeof rawInterval === 'number' ? rawInterval : 5;
    if (intervalMinutes === 0) return; // disabled

    const rawTemplate = await api.settings.get('commitMessage');
    const template =
      typeof rawTemplate === 'string' ? rawTemplate : 'auto-backup: {{date}}';

    await performCommit(notesDir, renderCommitMessage(template), api);
  }

  state.intervalHandle = setInterval(() => {
    maybeAutoCommit().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      api.log.error(`git-backup: interval error — ${msg}`);
    });
  }, 60 * 1000);

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  // GET /status
  api.routes.register('get', '/status', async (_req: unknown, res: any) => {
    try {
      const statusOut = await runGit('status --porcelain', notesDir);
      let lastCommitDate: string | null = null;
      try {
        lastCommitDate = await runGit('log -1 --format=%ci', notesDir);
      } catch {
        // no commits yet
      }
      res.json({
        dirty: statusOut.length > 0,
        lastCommitDate: lastCommitDate || null,
        lastCommitHash: state.lastCommitHash,
        pendingCommit: state.pendingCommit,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // GET /log — last 20 commits
  api.routes.register('get', '/log', async (_req: unknown, res: any) => {
    try {
      const logOut = await runGit(
        'log -20 --format={"hash":"%h","message":"%s","date":"%ci"}',
        notesDir,
      );
      const entries = logOut
        .split('\n')
        .filter(Boolean)
        .map((line: string) => {
          try {
            return JSON.parse(line) as unknown;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      res.json({ commits: entries });
    } catch {
      res.json({ commits: [] });
    }
  });

  // POST /commit — manual commit
  api.routes.register('post', '/commit', async (req: any, res: any) => {
    const customMessage: string =
      req.body?.message
        ? String(req.body.message)
        : renderCommitMessage('manual backup: {{date}}');
    try {
      await performCommit(notesDir, customMessage, api);
      res.json({ success: true, hash: state.lastCommitHash, message: customMessage });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // POST /push — git push
  api.routes.register('post', '/push', async (_req: unknown, res: any) => {
    try {
      const out = await runGit('push', notesDir);
      res.json({ success: true, output: out });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });
}

export function deactivate(): void {
  if (state.intervalHandle !== null) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.pendingCommit = false;
}
