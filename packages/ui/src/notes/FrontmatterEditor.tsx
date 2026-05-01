import * as React from "react";
import { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../lib/utils";

/** A flat key-value record representing YAML frontmatter. */
export type Frontmatter = Record<string, string>;

export interface FrontmatterEditorProps {
  frontmatter: Frontmatter;
  onChange: (updated: Frontmatter) => void;
  /** Maximum number of rows shown before "show more" toggle. Default 3. */
  collapsedLimit?: number;
  className?: string;
}

export function FrontmatterEditor({
  frontmatter,
  onChange,
  collapsedLimit = 3,
  className,
}: FrontmatterEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const entries = Object.entries(frontmatter);
  const visible = expanded ? entries : entries.slice(0, collapsedLimit);
  const hasMore = entries.length > collapsedLimit;

  const updateKey = (oldKey: string, newKeyName: string) => {
    if (oldKey === newKeyName) return;
    const updated: Frontmatter = {};
    for (const [k, v] of entries) {
      updated[k === oldKey ? newKeyName : k] = v;
    }
    onChange(updated);
  };

  const updateValue = (key: string, value: string) => {
    onChange({ ...frontmatter, [key]: value });
  };

  const removeKey = (key: string) => {
    const updated = { ...frontmatter };
    delete updated[key];
    onChange(updated);
  };

  const addEntry = () => {
    const k = newKey.trim();
    const v = newValue.trim();
    if (!k) return;
    onChange({ ...frontmatter, [k]: v });
    setNewKey("");
    setNewValue("");
  };

  return (
    <div
      className={cn(
        "border-t border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 py-2 px-3 text-xs",
        className,
      )}
    >
      <dl className="flex flex-col gap-1">
        {visible.map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <input
              className="w-24 shrink-0 bg-transparent border-b border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium outline-none focus:border-violet-500 px-0.5"
              value={key}
              onChange={(e) => updateKey(key, e.target.value)}
              aria-label={`Key: ${key}`}
            />
            <span className="text-gray-400 select-none">:</span>
            {key === "tags" ? (
              <input
                className="flex-1 bg-transparent border-b border-gray-300 dark:border-gray-600 outline-none focus:border-violet-500 px-0.5 text-violet-700 dark:text-violet-300"
                value={value}
                onChange={(e) => updateValue(key, e.target.value)}
                placeholder="tag1, tag2"
                aria-label="Tags value"
              />
            ) : (
              <input
                className="flex-1 bg-transparent border-b border-gray-300 dark:border-gray-600 outline-none focus:border-violet-500 px-0.5 text-gray-500 dark:text-gray-400"
                value={value}
                onChange={(e) => updateValue(key, e.target.value)}
                aria-label={`Value for ${key}`}
              />
            )}
            <button
              type="button"
              onClick={() => removeKey(key)}
              className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
              aria-label={`Remove ${key}`}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </dl>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 flex items-center gap-0.5 text-violet-500 hover:text-violet-600 dark:hover:text-violet-400 focus:outline-none"
        >
          {expanded ? (
            <>
              <ChevronUp size={12} /> Show less
            </>
          ) : (
            <>
              <ChevronDown size={12} /> Show {entries.length - collapsedLimit} more
            </>
          )}
        </button>
      )}

      {/* Add new key/value */}
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
        <input
          className="w-24 shrink-0 bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 outline-none focus:border-violet-500 px-0.5 text-gray-600 dark:text-gray-300 placeholder:text-gray-400"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="key"
          aria-label="New key"
          onKeyDown={(e) => e.key === "Enter" && addEntry()}
        />
        <span className="text-gray-400 select-none">:</span>
        <input
          className="flex-1 bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 outline-none focus:border-violet-500 px-0.5 text-gray-500 dark:text-gray-400 placeholder:text-gray-400"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="value"
          aria-label="New value"
          onKeyDown={(e) => e.key === "Enter" && addEntry()}
        />
        <button
          type="button"
          onClick={addEntry}
          disabled={!newKey.trim()}
          className="p-0.5 text-gray-400 hover:text-violet-500 transition-colors disabled:opacity-40"
          aria-label="Add frontmatter field"
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}
