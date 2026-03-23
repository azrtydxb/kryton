import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useCallback } from 'react';

interface PreviewProps {
  content: string;
  onLinkClick: (noteName: string) => void;
}

export function Preview({ content, onLinkClick }: PreviewProps) {
  // Transform [[wiki-links]] into anchor tags with a special data attribute
  const transformedContent = content.replace(
    /\[\[([^\]]+)\]\]/g,
    (_, linkText: string) => `<a class="wiki-link" data-wiki-target="${linkText}" href="#">${linkText}</a>`
  );

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const wikiTarget = target.closest<HTMLElement>('[data-wiki-target]');
    if (wikiTarget) {
      e.preventDefault();
      const noteName = wikiTarget.getAttribute('data-wiki-target');
      if (noteName) onLinkClick(noteName);
    }
  }, [onLinkClick]);

  return (
    <div className="markdown-preview p-6 max-w-3xl mx-auto" onClick={handleClick}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
      >
        {transformedContent}
      </ReactMarkdown>
    </div>
  );
}
