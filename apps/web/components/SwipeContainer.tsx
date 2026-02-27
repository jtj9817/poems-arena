import React from 'react';

export type SwipePhase = 'idle' | 'swipe-out' | 'swipe-in';

interface SwipeContainerProps {
  children: React.ReactNode;
  swipePhase: SwipePhase;
  onSwipeOutComplete: () => void;
  onSwipeInComplete: () => void;
}

/**
 * Wraps duel content and plays CSS keyframe animations for swipe transitions.
 * - swipe-out: current duel slides left and fades out (triggered after user acknowledges Verdict)
 * - swipe-in:  next duel slides in from the right (triggered after content swap)
 * Keyframes are defined in apps/web/index.html's <style> block.
 */
export const SwipeContainer: React.FC<SwipeContainerProps> = ({
  children,
  swipePhase,
  onSwipeOutComplete,
  onSwipeInComplete,
}) => {
  const animationStyle: React.CSSProperties =
    swipePhase === 'swipe-out'
      ? { animation: 'swipeOutLeft 0.35s ease-in forwards' }
      : swipePhase === 'swipe-in'
        ? { animation: 'swipeInRight 0.35s ease-out forwards' }
        : {};

  const handleAnimationEnd = () => {
    if (swipePhase === 'swipe-out') onSwipeOutComplete();
    else if (swipePhase === 'swipe-in') onSwipeInComplete();
  };

  return (
    <div
      data-animation-state={swipePhase}
      style={{ ...animationStyle, width: '100%', height: '100%', overflow: 'hidden' }}
      onAnimationEnd={handleAnimationEnd}
    >
      {children}
    </div>
  );
};
