import { useState, useEffect, useCallback } from 'react';
import { TagsScreen } from '@azrtydxb/ui';
import { api, TagData, TagNoteData } from '../../lib/api';

interface TagPaneProps {
  onNoteSelect: (path: string) => void;
}

/**
 * Thin wrapper around @azrtydxb/ui TagsScreen.
 * Manages data-fetching; the ui component is purely presentational.
 */
export function TagPane({ onNoteSelect }: TagPaneProps) {
  const [tags, setTags] = useState<TagData[]>([]);
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
    void (async () => {
      await fetchTags();
    })();
  }, [fetchTags]);

  const handleTagSelect = useCallback(async (tag: string | null) => {
    setSelectedTag(tag);
    if (!tag) {
      setTagNotes([]);
      return;
    }
    setLoadingNotes(true);
    try {
      const notes = await api.getNotesByTag(tag);
      setTagNotes(notes);
    } catch {
      setTagNotes([]);
    } finally {
      setLoadingNotes(false);
    }
  }, []);

  const tagEntries = tags.map(({ tag, count }) => ({ tag, count }));
  const noteItems = tagNotes.map(({ notePath, title }) => ({ notePath, title }));

  return (
    <TagsScreen
      tags={tagEntries}
      tagNotes={noteItems}
      loadingNotes={loadingNotes}
      selectedTag={selectedTag}
      onTagSelect={handleTagSelect}
      onNoteSelect={onNoteSelect}
    />
  );
}
