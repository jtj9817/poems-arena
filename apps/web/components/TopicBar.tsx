import React, { useId } from 'react';
import type { TopicMeta } from '@sanctuary/shared';

interface TopicBarProps {
  idPrefix?: string;
  topics: TopicMeta[];
  activeTopicId: string | null;
  onSelect: (topicId: string | null) => void;
}

export const TopicBar: React.FC<TopicBarProps> = ({
  idPrefix,
  topics,
  activeTopicId,
  onSelect,
}) => {
  const reactId = useId();
  const baseId = idPrefix ?? `topic-bar-${reactId.replace(/:/g, '')}`;

  return (
    <div id={`${baseId}-scroll`} className="overflow-x-auto no-scrollbar">
      <div
        id={`${baseId}-list`}
        className="flex gap-2 px-1 pb-1"
        style={{ minWidth: 'max-content' }}
      >
        <button
          id={`${baseId}-all-btn`}
          onClick={() => onSelect(null)}
          className={`min-h-[44px] px-4 py-2 text-sm font-sans font-medium rounded-full transition-all whitespace-nowrap ${
            activeTopicId === null
              ? 'bg-ink text-paper shadow-md'
              : 'text-ink/60 hover:bg-stock hover:text-ink border border-transparent hover:border-pencil/20'
          }`}
        >
          All
        </button>

        {topics.map((topic) => (
          <button
            key={topic.id}
            id={`${baseId}-topic-${topic.id}-btn`}
            onClick={() => onSelect(topic.id)}
            className={`min-h-[44px] px-4 py-2 text-sm font-sans font-medium rounded-full transition-all whitespace-nowrap ${
              activeTopicId === topic.id
                ? 'bg-ink text-paper shadow-md'
                : 'text-ink/60 hover:bg-stock hover:text-ink border border-transparent hover:border-pencil/20'
            }`}
          >
            {topic.label}
          </button>
        ))}
      </div>
    </div>
  );
};
