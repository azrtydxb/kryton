import type { ClientPluginAPI } from '../../../types/client';

const { React } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect, useCallback } = React;

interface Template {
  name: string;
  path: string;
}

export function activate(api: ClientPluginAPI): void {
  // --- Command: Create from Template ---
  api.commands.register({
    id: 'templater:create-from-template',
    name: 'Create from Template',
    execute: async () => {
      try {
        const resp = await api.api.fetch('/templates');
        if (!resp.ok) {
          api.notify.error('Failed to fetch templates');
          return;
        }
        const data = await resp.json() as { templates: Template[] };

        if (data.templates.length === 0) {
          api.notify.info('No templates found. Create .md files in a Templates/ folder.');
          return;
        }

        // List template names in a notification so the user knows what's available.
        // Full UI selection requires a modal which is beyond v1 scope.
        const names = data.templates.map((t) => t.name).join(', ');
        api.notify.info(`Available templates: ${names}. Use "Apply Template" note action to insert.`);
      } catch {
        api.notify.error('Failed to fetch templates');
      }
    },
  });

  // --- Note Action: Apply Template ---
  api.ui.registerNoteAction({
    id: 'templater:apply-template',
    label: 'Apply Template',
    icon: 'file-text',
    onClick: async (notePath: string) => {
      try {
        // Fetch available templates
        const templatesResp = await api.api.fetch('/templates');
        if (!templatesResp.ok) {
          api.notify.error('Failed to fetch templates');
          return;
        }
        const { templates } = await templatesResp.json() as { templates: Template[] };

        if (templates.length === 0) {
          api.notify.info('No templates found. Create .md files in a Templates/ folder.');
          return;
        }

        // Use the first available template (v1: simple auto-select)
        // In a full implementation this would open a picker dialog.
        const selected = templates[0];

        // Derive note title from path
        const parts = notePath.split('/');
        const filename = parts[parts.length - 1] ?? notePath;
        const title = filename.replace(/\.md$/i, '');

        // Fetch the template file content via notes API
        const noteResp = await api.api.fetch(`/api/notes/${encodeURIComponent(selected.path)}`);
        if (!noteResp.ok) {
          api.notify.error(`Failed to read template: ${selected.name}`);
          return;
        }
        const noteData = await noteResp.json() as { content?: string };
        const templateContent = noteData.content ?? '';

        // Process the template
        const processResp = await api.api.fetch('/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template: templateContent,
            variables: { title },
          }),
        });

        if (!processResp.ok) {
          api.notify.error('Failed to process template');
          return;
        }

        const { content: processed } = await processResp.json() as { content: string };

        // Save processed content back to the target note
        const saveResp = await api.api.fetch(`/api/notes/${encodeURIComponent(notePath)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: processed }),
        });

        if (saveResp.ok) {
          api.notify.success(`Template "${selected.name}" applied to note`);
        } else {
          api.notify.error('Failed to save processed template to note');
        }
      } catch {
        api.notify.error('Failed to apply template');
      }
    },
  });

  // --- Sidebar Panel: Template Browser ---
  function TemplaterPanel(): any {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const currentNote = api.context.useCurrentNote();

    const fetchTemplates = useCallback(async () => {
      setLoading(true);
      try {
        const resp = await api.api.fetch('/templates');
        if (resp.ok) {
          const data = await resp.json() as { templates: Template[] };
          setTemplates(data.templates);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      fetchTemplates();
    }, [fetchTemplates]);

    async function applyTemplate(template: Template): Promise<void> {
      if (!currentNote) {
        api.notify.info('Open a note first to apply a template.');
        return;
      }

      try {
        const parts = currentNote.path.split('/');
        const filename = parts[parts.length - 1] ?? currentNote.path;
        const title = filename.replace(/\.md$/i, '');

        const processResp = await api.api.fetch('/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template: currentNote.content,
            variables: { title },
          }),
        });

        if (!processResp.ok) {
          api.notify.error('Failed to process template');
          return;
        }

        const { content: processed } = await processResp.json() as { content: string };

        const saveResp = await api.api.fetch(`/api/notes/${encodeURIComponent(currentNote.path)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: processed }),
        });

        if (saveResp.ok) {
          api.notify.success(`Template "${template.name}" applied`);
        } else {
          api.notify.error('Failed to save note');
        }
      } catch {
        api.notify.error('Failed to apply template');
      }
    }

    if (loading) {
      return h('div', { className: 'flex items-center justify-center h-full p-4' },
        h('div', { className: 'flex items-center gap-2 text-sm text-gray-400' },
          h('div', { className: 'w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin' }),
          'Loading templates...'
        )
      );
    }

    if (templates.length === 0) {
      return h('div', { className: 'flex flex-col h-full' },
        h('div', { className: 'flex-1 flex flex-col items-center justify-center p-4 text-center' },
          h('p', { className: 'text-sm text-gray-400 dark:text-gray-500' },
            'No templates found.'
          ),
          h('p', { className: 'text-xs text-gray-400 dark:text-gray-500 mt-1' },
            'Create .md files in a Templates/ folder.'
          )
        )
      );
    }

    return h('div', { className: 'flex flex-col h-full' },
      h('ul', { className: 'flex-1 overflow-y-auto py-1' },
        templates.map((template: Template) =>
          h('li', { key: template.path },
            h('button', {
              onClick: () => applyTemplate(template),
              className: 'w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group',
              title: `Apply template: ${template.name}`,
            },
              h('span', { className: 'block text-sm text-gray-800 dark:text-gray-200 truncate' },
                template.name
              ),
              h('span', { className: 'block text-xs text-gray-400 dark:text-gray-500 truncate' },
                template.path
              )
            )
          )
        )
      ),
      h('div', { className: 'px-3 py-2 border-t border-gray-200 dark:border-gray-700' },
        h('button', {
          onClick: fetchTemplates,
          className: 'text-xs text-gray-400 dark:text-gray-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors',
        }, 'Refresh')
      )
    );
  }

  api.ui.registerSidebarPanel(TemplaterPanel, {
    id: 'templater',
    title: 'Templates',
    icon: 'file-text',
    order: 30,
  });
}

export function deactivate(): void {
  // Nothing to clean up
}
