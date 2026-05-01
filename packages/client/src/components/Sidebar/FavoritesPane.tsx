import { FavoritesSection } from '@azrtydxb/ui';

interface FavoritesPaneProps {
  starredPaths: Set<string>;
  onSelect: (path: string) => void;
  onToggleStar: (path: string) => void;
}

/**
 * Thin wrapper around @azrtydxb/ui FavoritesSection.
 * Props are identical — this just re-exports through the component layer.
 */
export function FavoritesPane({ starredPaths, onSelect, onToggleStar }: FavoritesPaneProps) {
  return (
    <FavoritesSection
      starredPaths={starredPaths}
      onSelect={onSelect}
      onToggleStar={onToggleStar}
    />
  );
}
