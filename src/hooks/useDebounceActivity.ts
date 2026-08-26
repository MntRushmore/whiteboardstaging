import React, { useEffect, useRef } from "react";
import { Editor } from "tldraw";

/**
 * Whole-document idle debounce. Not used by the live pencil tutor
 * (`useTutorEngine` debounces ~400ms after a stroke cluster instead).
 * Kept for any non-tutor callers.
 */
export function useDebounceActivity(
  callback: () => void,
  delay: number = 3000,
  editor?: Editor,
  shouldIgnoreRef?: React.MutableRefObject<boolean>,
  isProcessingRef?: React.MutableRefObject<boolean>
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editor) return;

    // Clear any existing timeout
    const clearTimer = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    // Set up a new timer, to be called whenever there's activity
    const resetTimer = () => {
      clearTimer();
      timeoutRef.current = setTimeout(() => {
        callback();
      }, delay);
    };

    // Listen to tldraw's history changes (actual edits)
    // This will only trigger on drawing, typing, shape changes, etc.
    // Not on panning, zooming, or clicking UI buttons
    const handleHistoryChange = () => {
      // Ignore changes if we're updating images (accept/reject)
      if (shouldIgnoreRef?.current) {
        return;
      }
      
      // Ignore changes if we're currently processing/generating
      // This prevents the generated image from triggering a new cycle
      if (isProcessingRef?.current) {
        return;
      }
      
      resetTimer();
    };

    // Listen for changes to the editor's content
    const dispose = editor.store.listen(handleHistoryChange, {
      source: 'user',
      scope: 'document'
    });

    // DON'T set up initial timer - only trigger on actual user activity
    // This prevents auto-generation on page load or when dependencies change

    return () => {
      clearTimer();
      dispose();
    };
  }, [callback, delay, editor, shouldIgnoreRef, isProcessingRef]);
}
