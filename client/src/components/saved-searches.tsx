import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bookmark, X } from "lucide-react";
import type { Bookmark as BookmarkType } from "@shared/schema";

interface SavedSearchesProps {
  savedSearches: BookmarkType[];
  onSelect: (query: string) => void;
  onRemove: (id: number) => void;
}

export function SavedSearches({ savedSearches, onSelect, onRemove }: SavedSearchesProps) {
  if (savedSearches.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5" data-testid="saved-searches-section">
      <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        <Bookmark className="w-3 h-3" />
        Saved Searches
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {savedSearches.map((bookmark) => (
          <Badge
            key={bookmark.id}
            variant="secondary"
            className="cursor-pointer group gap-1 pr-1"
            data-testid={`saved-search-${bookmark.id}`}
          >
            <span onClick={() => onSelect(bookmark.searchQuery || bookmark.label || "")}>
              {bookmark.label || bookmark.searchQuery}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(bookmark.id);
              }}
              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Remove saved search: ${bookmark.label || bookmark.searchQuery}`}
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}
