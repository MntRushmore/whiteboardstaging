"use client";

type Props = {
  visible: boolean;
};

export function GenerationSkeleton({ visible }: Props) {
  if (!visible) return null;

  return (
    <>
      <style>{`
        @keyframes ai-skeleton-shimmer {
          0% { background-position: -1200px 0; }
          100% { background-position: 1200px 0; }
        }
        @keyframes ai-skeleton-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.85; }
        }
        @keyframes ai-skeleton-fade-in {
          from { opacity: 0; transform: scale(0.99); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 80,
          left: 80,
          right: 80,
          bottom: 80,
          zIndex: 900,
          pointerEvents: "none",
          animation: "ai-skeleton-fade-in 180ms ease-out",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 16,
            border: "1px dashed rgba(99, 102, 241, 0.45)",
            background:
              "linear-gradient(110deg, rgba(244,244,255,0) 30%, rgba(165,180,252,0.18) 50%, rgba(244,244,255,0) 70%)",
            backgroundSize: "1200px 100%",
            animation:
              "ai-skeleton-shimmer 1.6s linear infinite, ai-skeleton-pulse 2.2s ease-in-out infinite",
          }}
        />
      </div>
    </>
  );
}
