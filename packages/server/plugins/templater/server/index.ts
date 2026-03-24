import type { PluginAPI, NoteEntry } from '../../../types/server';

/**
 * Pad a number to 2 digits.
 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Apply a date format string.
 * Supported tokens: YYYY MM DD HH mm ss
 */
function applyDateFormat(date: Date, format: string): string {
  return format
    .replace('YYYY', String(date.getFullYear()))
    .replace('MM', pad2(date.getMonth() + 1))
    .replace('DD', pad2(date.getDate()))
    .replace('HH', pad2(date.getHours()))
    .replace('mm', pad2(date.getMinutes()))
    .replace('ss', pad2(date.getSeconds()));
}

/**
 * Generate a short random alphanumeric ID.
 */
function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Process a template string, replacing all known variables.
 */
function processTemplate(template: string, variables: Record<string, string> = {}): string {
  const now = new Date();

  // Replace {{date:FORMAT}} first (more specific)
  let result = template.replace(/\{\{date:([^}]+)\}\}/g, (_match, fmt: string) => {
    return applyDateFormat(now, fmt.trim());
  });

  // Replace built-in variables
  result = result.replace(/\{\{date\}\}/g, applyDateFormat(now, 'YYYY-MM-DD'));
  result = result.replace(/\{\{time\}\}/g, `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
  result = result.replace(/\{\{now\}\}/g, now.toISOString());
  result = result.replace(/\{\{random\}\}/g, randomId());

  // Replace user-supplied variables (e.g. {{title}})
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : _match;
  });

  return result;
}

/**
 * Recursively collect all file paths from a NoteEntry tree.
 */
function collectPaths(entries: NoteEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'file') {
      paths.push(entry.path);
    } else if (entry.children) {
      paths.push(...collectPaths(entry.children));
    }
  }
  return paths;
}

export function activate(api: PluginAPI): void {
  api.log.info('Templater plugin activated');

  // POST /process — process a template string
  api.routes.register('post', '/process', async (req, res) => {
    try {
      const { template, variables } = req.body as {
        template?: string;
        variables?: Record<string, string>;
      };

      if (typeof template !== 'string') {
        res.status(400).json({ error: 'template (string) is required' });
        return;
      }

      const processed = processTemplate(template, variables ?? {});
      res.json({ content: processed });
    } catch (err: any) {
      api.log.error('Templater /process error', err);
      res.status(500).json({ error: 'Failed to process template' });
    }
  });

  // GET /templates — list available template files in Templates/ folder
  api.routes.register('get', '/templates', async (req, res) => {
    try {
      const userId: string = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      let entries: NoteEntry[] = [];
      try {
        entries = await api.notes.list(userId, 'Templates');
      } catch {
        // Templates folder may not exist yet
        res.json({ templates: [] });
        return;
      }

      const paths = collectPaths(entries);
      const templates = paths
        .filter((p) => p.endsWith('.md'))
        .map((p) => {
          const parts = p.split('/');
          const filename = parts[parts.length - 1] ?? p;
          const name = filename.replace(/\.md$/i, '');
          return { name, path: p };
        });

      res.json({ templates });
    } catch (err: any) {
      api.log.error('Templater /templates error', err);
      res.status(500).json({ error: 'Failed to list templates' });
    }
  });
}

export function deactivate(): void {
  // Nothing to clean up
}
