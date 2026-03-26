import { useState } from 'react';
import type { Frontmatter } from '../../lib/frontmatter';

interface FrontmatterBlockProps {
  frontmatter: Frontmatter;
}

const COLLAPSED_LIMIT = 3;

export function FrontmatterBlock({ frontmatter }: FrontmatterBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const entries = Object.entries(frontmatter);
  const visible = expanded ? entries : entries.slice(0, COLLAPSED_LIMIT);
  const hasMore = entries.length > COLLAPSED_LIMIT;

  return (
    <div className="frontmatter-block border-t border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 py-2 px-3 mb-4 text-xs text-gray-500 dark:text-gray-400">
      <dl className="flex flex-col gap-1">
        {visible.map(([key, value]) => (
          <div key={key} className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-medium text-gray-600 dark:text-gray-300 shrink-0">{key}:</dt>
            <dd className="m-0">
              {key === 'tags' ? (
                <TagList value={value} />
              ) : (
                <span>{value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-violet-500 hover:text-violet-600 dark:hover:text-violet-400 focus:outline-none"
        >
          {expanded ? 'Show less' : `Show ${entries.length - COLLAPSED_LIMIT} more`}
        </button>
      )}
    </div>
  );
}

function TagList({ value }: { value: string }) {
  const tags = value.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-block px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium"
        >
          {tag}
        </span>
      ))}
    </span>
  );
}
