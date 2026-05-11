/**
 * EditorToolbar — formatting action bar for the NoteEditor.
 *
 * Decoupled from any specific editor engine: it fires `onCommand(commandName)`
 * and consumers wire it to CodeMirror, a contenteditable, or an iframe-based
 * editor. Includes a view-mode toggle (edit / split / preview).
 *
 * Styling matches the rest of the Kryton chrome — `--bg-1` surface with a
 * `--line` bottom border, 36px tall, mono iconography, `--accent` hover tint.
 * Tooltips come from the native `title` attribute and adapt to the OS
 * (`⌘B` on macOS, `Ctrl+B` everywhere else).
 */
import * as React from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  Image,
  ImagePlus,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Minus,
  Table,
  Undo2,
  Redo2,
  Eye,
  Pencil,
} from "lucide-react";

export type ViewMode = "edit" | "preview" | "split";

const IS_MAC =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const SHIFT = IS_MAC ? "⇧" : "Shift";
const SEP = IS_MAC ? "" : "+";

/** Format a keyboard shortcut hint for tooltips. */
function kbd(...parts: string[]): string {
  return parts.join(SEP);
}

export interface EditorToolbarProps {
  onCommand: (command: string) => void;
  onUploadImage?: (file: File) => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  className?: string;
}

function ToolbarButton({
  icon: Icon,
  title,
  onClick,
  active,
}: {
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }>;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  const [hover, setHover] = React.useState(false);
  const tinted = active || hover;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={title}
      aria-pressed={active}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 6,
        background: active
          ? "var(--accent-soft)"
          : hover
            ? "var(--bg-hover)"
            : "transparent",
        color: tinted ? "var(--accent)" : "var(--fg-3)",
        border: "none",
        cursor: "pointer",
        transition: "background 120ms, color 120ms",
      }}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}

function ToolbarSep() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 1,
        height: 18,
        margin: "0 6px",
        background: "var(--line)",
      }}
    />
  );
}

export function EditorToolbar({
  onCommand,
  onUploadImage,
  viewMode = "edit",
  onViewModeChange,
  className,
}: EditorToolbarProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && onUploadImage) onUploadImage(file);
      e.target.value = "";
    },
    [onUploadImage],
  );

  return (
    <div
      className={className}
      role="toolbar"
      aria-label="Editor formatting toolbar"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        flexShrink: 0,
        gap: 4,
        height: 36,
        padding: "0 8px",
        background: "var(--bg-1)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
        aria-hidden="true"
      />

      {/* History */}
      <ToolbarButton icon={Undo2} title={`Undo (${kbd(MOD, "Z")})`} onClick={() => onCommand("undo")} />
      <ToolbarButton icon={Redo2} title={`Redo (${kbd(MOD, SHIFT, "Z")})`} onClick={() => onCommand("redo")} />
      <ToolbarSep />

      {/* Headings */}
      <ToolbarButton icon={Heading1} title="Heading 1" onClick={() => onCommand("heading1")} />
      <ToolbarButton icon={Heading2} title="Heading 2" onClick={() => onCommand("heading2")} />
      <ToolbarButton icon={Heading3} title="Heading 3" onClick={() => onCommand("heading3")} />
      <ToolbarSep />

      {/* Inline formatting */}
      <ToolbarButton icon={Bold} title={`Bold (${kbd(MOD, "B")})`} onClick={() => onCommand("bold")} />
      <ToolbarButton icon={Italic} title={`Italic (${kbd(MOD, "I")})`} onClick={() => onCommand("italic")} />
      <ToolbarButton icon={Strikethrough} title="Strikethrough" onClick={() => onCommand("strikethrough")} />
      <ToolbarButton icon={Code} title="Inline code" onClick={() => onCommand("code")} />
      <ToolbarSep />

      {/* Links & images */}
      <ToolbarButton icon={Link} title="Wiki link" onClick={() => onCommand("link")} />
      <ToolbarButton icon={Image} title="Insert image" onClick={() => onCommand("image")} />
      {onUploadImage && (
        <ToolbarButton
          icon={ImagePlus}
          title="Upload image"
          onClick={() => fileInputRef.current?.click()}
        />
      )}
      <ToolbarSep />

      {/* Lists */}
      <ToolbarButton icon={List} title="Bullet list" onClick={() => onCommand("ul")} />
      <ToolbarButton icon={ListOrdered} title="Numbered list" onClick={() => onCommand("ol")} />
      <ToolbarButton icon={CheckSquare} title="Task list" onClick={() => onCommand("checkbox")} />
      <ToolbarSep />

      {/* Block formatting */}
      <ToolbarButton icon={Quote} title="Blockquote" onClick={() => onCommand("blockquote")} />
      <ToolbarButton icon={Minus} title="Horizontal rule" onClick={() => onCommand("hr")} />
      <ToolbarButton icon={Table} title="Insert table" onClick={() => onCommand("table")} />

      {/* View mode toggle */}
      {onViewModeChange && (
        <>
          <div style={{ flex: 1 }} />
          <ToolbarButton
            icon={Pencil}
            title="Edit mode"
            active={viewMode === "edit"}
            onClick={() => onViewModeChange("edit")}
          />
          <ToolbarButton
            icon={Eye}
            title="Preview mode"
            active={viewMode === "preview"}
            onClick={() => onViewModeChange("preview")}
          />
        </>
      )}
    </div>
  );
}
