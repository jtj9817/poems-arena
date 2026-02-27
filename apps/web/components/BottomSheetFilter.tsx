import React from 'react';
import type { TopicMeta } from '@sanctuary/shared';

interface BottomSheetFilterProps {
  topics: TopicMeta[];
  activeTopicId: string | null;
  onSelect: (topicId: string | null) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const BottomSheetFilter: React.FC<BottomSheetFilterProps> = ({
  topics,
  activeTopicId,
  onSelect,
  isOpen,
  onClose,
}) => {
  const handleSelect = (topicId: string | null) => {
    onSelect(topicId);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.4)',
          zIndex: 40,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 250ms ease',
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)',
          backgroundColor: 'var(--color-paper, #FAF8F5)',
          borderTopLeftRadius: '16px',
          borderTopRightRadius: '16px',
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        }}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-pencil/30" />
        </div>

        <div className="px-6 pb-2">
          <h3 className="text-sm font-sans font-semibold tracking-widest uppercase text-pencil mb-4">
            Filter by Topic
          </h3>

          <div className="flex flex-col gap-1">
            <button
              onClick={() => handleSelect(null)}
              className={`w-full text-left px-4 py-3 rounded text-sm font-sans font-medium transition-colors ${
                activeTopicId === null ? 'bg-ink text-paper' : 'text-ink hover:bg-stock'
              }`}
            >
              All Topics
            </button>

            {topics.map((topic) => (
              <button
                key={topic.id}
                onClick={() => handleSelect(topic.id)}
                className={`w-full text-left px-4 py-3 rounded text-sm font-sans font-medium transition-colors ${
                  activeTopicId === topic.id ? 'bg-ink text-paper' : 'text-ink hover:bg-stock'
                }`}
              >
                {topic.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-6" />
      </div>
    </>
  );
};
