"use client";

import React from "react";
import { logger } from "@/lib/logger";

interface Props {
  children: React.ReactNode;
}
interface State {
  failed: boolean;
}

/**
 * Keeps a Live UI crash from taking the whole board down: logs once and renders nothing.
 * The canvas, autosave and the legacy pipeline keep working underneath.
 */
export class LiveErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.error(
      {
        module: "live-ui",
        error: { message: error.message, name: error.name, stack: error.stack },
        componentStack: info.componentStack,
      },
      "Live UI crashed; hiding the Live layer for this session",
    );
  }

  render(): React.ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
