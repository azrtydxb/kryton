import { useState, useEffect, useCallback } from 'react';
import { api, TagData, TagNoteData } from '../../lib/api';
import { ChevronRight, Hash, X } from 'lucide-react';

interface TagPaneProps {
  onNoteSelect: (path: string) => void;
}

export function TagPane({ onNoteSelect }: TagPaneProps) {
  const [tags, setTags] = useState<TagData[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagNotes, setTagNotes] = useState<TagNoteData[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  const fetchTags = useCallback(async () => {
    try {
      const data = await api.getTags();
      setTags(data);
    } catch {
      setTags([]);
    }
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const handleTagClick = useCallback(async (tag: string) => {
    if (selectedTag === tag) {
      setSelectedTag(null);
      setTagNotes([]);
      return;
    }
    setSelectedTag(tag);
    setLoadingNotes(true);
    try {
      const notes = await api.getNotesByTag(tag);
      setTagNotes(notes);
    } catch {
      setTagNotes([]);
    } finally {
      setLoadingNotes(false);
    }
  }, [selectedTag]);

  if (tags.length === 0) return null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
      >
        <ChevronRight
          size={12}
          className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        Tags
      </button>
      {expanded && (
        <div className="px-2 pb-2 flex-1 overflow-y-auto">
          <div className="flex flex-wrap gap-1">
            {tags.map(({ tag, count }) => (
              <button
                key={tag}
                onClick={() => handleTagClick(tag)}
                className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs transition-colors ${
                  selectedTag === tag
                    ? 'bg-violet-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                <Hash size={10} />
                {tag}
                <span className={`ml-0.5 ${selectedTag === tag ? 'text-violet-100' : 'text-gray-400 dark:text-gray-500'}`}>
                  {count}
                </span>
              </button>
            ))}
          </div>

          {selectedTag && (
            <div className="mt-2 bg-white dark:bg-surface-950 rounded-md border p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  #{selectedTag}
                </span>
                <button
                  onClick={() => { setSelectedTag(null); setTagNotes([]); }}
                  className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <X size={12} className="text-gray-400" />
                </button>
              </div>
              {loadingNotes ? (
                <p className="text-xs text-gray-400">Loading...</p>
              ) : (
                <ul className="space-y-0.5">
                  {tagNotes.map((note) => (
                    <li key={note.notePath}>
                      <button
                        onClick={() => onNoteSelect(note.notePath)}
                        className="text-xs text-violet-500 dark:text-violet-400 hover:underline truncate block w-full text-left py-0.5"
                      >
                        {note.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
