"use client";

import {
  BaseBoxShapeUtil,
  SVGContainer,
  T,
  type TLBaseShape,
} from "tldraw";
import { HAND_NIB_PX, TUTOR_RED } from "./layout";
import { polylineToSvgD } from "./hand/path";

export type TutorHandPoint = { x: number; y: number; z?: number };
export type TutorHandSegment = { points: TutorHandPoint[] };

export type TutorHandShape = TLBaseShape<
  "tutor-hand",
  { w: number; h: number; color: string; stroke: number; segments: TutorHandSegment[] }
>;

const pointValidator = T.object({
  x: T.number,
  y: T.number,
  z: T.optional(T.number),
});

const segmentValidator = T.object({
  points: T.arrayOf(pointValidator),
});

export class TutorHandShapeUtil extends BaseBoxShapeUtil<TutorHandShape> {
  static override type = "tutor-hand" as const;
  static override props = {
    w: T.number,
    h: T.number,
    color: T.string,
    stroke: T.number,
    segments: T.arrayOf(segmentValidator),
  };

  getDefaultProps(): TutorHandShape["props"] {
    return {
      w: 80,
      h: 18,
      color: TUTOR_RED,
      stroke: HAND_NIB_PX,
      segments: [],
    };
  }

  override canEdit() {
    return false;
  }

  override canResize() {
    return false;
  }

  override hideSelectionBoundsFg() {
    return true;
  }

  component(shape: TutorHandShape) {
    return (
      <SVGContainer>
        <g
          fill="none"
          stroke={shape.props.color}
          strokeWidth={shape.props.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        >
          {shape.props.segments.map((segment, index) => {
            const d = polylineToSvgD(segment.points);
            if (!d) return null;
            return <path key={index} d={d} />;
          })}
        </g>
      </SVGContainer>
    );
  }

  indicator(shape: TutorHandShape) {
    return <rect width={shape.props.w} height={shape.props.h} fill="none" />;
  }
}
