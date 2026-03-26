interface BreadcrumbsProps {
  path: string; // e.g. "Projects/Mnemo/Tasks.md"
  onFolderClick: (folderPath: string) => void;
}

export function Breadcrumbs({ path, onFolderClick }: BreadcrumbsProps) {
  const segments = path.split('/');

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        if (isLast) {
          return (
            <span key={index} className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              {segment}
            </span>
          );
        }

        const folderPath = segments.slice(0, index + 1).join('/');

        return (
          <span key={index} className="flex items-center gap-1">
            <button
              onClick={() => onFolderClick(folderPath)}
              className="text-xs text-gray-400 hover:text-violet-400 cursor-pointer transition-colors"
            >
              {segment}
            </button>
            <span className="text-xs text-gray-600 dark:text-gray-600 select-none">/</span>
          </span>
        );
      })}
    </div>
  );
}
