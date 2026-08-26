"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { PAPER } from "@/lib/tutor/layout";

type Props = { children: ReactNode };
type State = { failed: boolean };

/** Keep paper on screen if the editor throws. License blanks are handled separately. */
export class TldrawErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("tldraw board error", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          data-testid="tldraw-error-fallback"
          style={{
            position: "absolute",
            inset: 0,
            background: PAPER,
          }}
        />
      );
    }
    return this.props.children;
  }
}
