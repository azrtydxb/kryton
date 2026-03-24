import type { PluginAPI } from '../../../types/server';

/**
 * Build a word-boundary-aware regex for a tag name.
 * Matches #tagname not followed by word characters (letters, digits, hyphens, underscores).
 */
function tagRegex(tagName: string): RegExp {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`#${escaped}(?![\\w-])`, 'g');
}

/**
 * Recursively collect all file paths from a NoteEntry tree.
 */
function collectPaths(entries: any[]): string[] {
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
  api.log.info('Tag Wrangler plugin activated');

  // GET /tags — list all tags with usage counts
  api.routes.register('get', '/tags', async (req, res) => {
    try {
      const userId: string = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const entries = await api.notes.list(userId);
      const paths = collectPaths(entries);

      const tagCounts: Record<string, number> = {};

      await Promise.all(
        paths.map(async (notePath) => {
          try {
            const note = await api.notes.get(userId, notePath);
            const matches = note.content.match(/#([\w-]+)/g);
            if (matches) {
              for (const match of matches) {
                const tag = match.slice(1); // strip leading #
                tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
              }
            }
          } catch {
            // skip unreadable notes
          }
        })
      );

      const tags = Object.entries(tagCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      res.json({ tags });
    } catch (err: any) {
      api.log.error('Tag Wrangler /tags error', err);
      res.status(500).json({ error: 'Failed to list tags' });
    }
  });

  // POST /rename — rename a tag across all notes
  api.routes.register('post', '/rename', async (req, res) => {
    try {
      const userId: string = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { oldTag, newTag } = req.body as { oldTag?: string; newTag?: string };
      if (!oldTag || !newTag) {
        res.status(400).json({ error: 'oldTag and newTag are required' });
        return;
      }

      const entries = await api.notes.list(userId);
      const paths = collectPaths(entries);
      const regex = tagRegex(oldTag);

      let updatedCount = 0;

      await Promise.all(
        paths.map(async (notePath) => {
          try {
            const note = await api.notes.get(userId, notePath);
            if (regex.test(note.content)) {
              regex.lastIndex = 0;
              const updated = note.content.replace(regex, `#${newTag}`);
              await api.notes.update(userId, notePath, updated);
              updatedCount++;
            }
          } catch {
            // skip notes that can't be read/written
          }
        })
      );

      res.json({ success: true, updatedNotes: updatedCount });
    } catch (err: any) {
      api.log.error('Tag Wrangler /rename error', err);
      res.status(500).json({ error: 'Failed to rename tag' });
    }
  });

  // POST /merge — merge one tag into another (alias for rename)
  api.routes.register('post', '/merge', async (req, res) => {
    try {
      const userId: string = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { sourceTag, targetTag } = req.body as { sourceTag?: string; targetTag?: string };
      if (!sourceTag || !targetTag) {
        res.status(400).json({ error: 'sourceTag and targetTag are required' });
        return;
      }

      const entries = await api.notes.list(userId);
      const paths = collectPaths(entries);
      const regex = tagRegex(sourceTag);

      let updatedCount = 0;

      await Promise.all(
        paths.map(async (notePath) => {
          try {
            const note = await api.notes.get(userId, notePath);
            if (regex.test(note.content)) {
              regex.lastIndex = 0;
              const updated = note.content.replace(regex, `#${targetTag}`);
              await api.notes.update(userId, notePath, updated);
              updatedCount++;
            }
          } catch {
            // skip notes that can't be read/written
          }
        })
      );

      res.json({ success: true, updatedNotes: updatedCount });
    } catch (err: any) {
      api.log.error('Tag Wrangler /merge error', err);
      res.status(500).json({ error: 'Failed to merge tag' });
    }
  });

  // POST /delete — remove a tag from all notes
  api.routes.register('post', '/delete', async (req, res) => {
    try {
      const userId: string = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { tag } = req.body as { tag?: string };
      if (!tag) {
        res.status(400).json({ error: 'tag is required' });
        return;
      }

      const entries = await api.notes.list(userId);
      const paths = collectPaths(entries);
      const regex = tagRegex(tag);

      let updatedCount = 0;

      await Promise.all(
        paths.map(async (notePath) => {
          try {
            const note = await api.notes.get(userId, notePath);
            if (regex.test(note.content)) {
              regex.lastIndex = 0;
              // Remove the tag and clean up any double-spaces left behind
              const updated = note.content.replace(regex, '').replace(/  +/g, ' ').trimEnd();
              await api.notes.update(userId, notePath, updated);
              updatedCount++;
            }
          } catch {
            // skip notes that can't be read/written
          }
        })
      );

      res.json({ success: true, updatedNotes: updatedCount });
    } catch (err: any) {
      api.log.error('Tag Wrangler /delete error', err);
      res.status(500).json({ error: 'Failed to delete tag' });
    }
  });
}

export function deactivate(): void {
  // Nothing to clean up
}
