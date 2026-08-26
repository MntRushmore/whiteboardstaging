"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  onReset?: () => void;
};
type State = { gen: number };

/** Remount the editor after a throw. Never replace the page with empty beige. */
export class TldrawErrorBoundary extends Component<Props, State> {
  state: State = { gen: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return {};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("tldraw board error", error, info.componentStack);
    this.setState((prev) => ({ gen: prev.gen + 1 }));
    this.props.onReset?.();
  }

  render() {
    return <div key={this.state.gen}>{this.props.children}</div>;
  }
}
