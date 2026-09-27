import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

// Two dancers in a close hold — the Tango mark.
//
// Drawn rather than set in type. No emoji is a tango couple (the nearest are
// two separate dancers, which is the opposite of the point), and a notification
// small-icon style glyph would flatten to a blob at this size.
//
// It is strokes, not a filled silhouette, because the tab renders it at 18px:
// a silhouette turns to mud there, while round-capped strokes stay legible.
// The pose is the one thing that has to survive shrinking — heads tilted
// together, arms joined in an arc, and one leg extended into the tango line —
// so everything else (a second supporting leg, hands, any hint of a dress) is
// left out.
//
// The web draws the same paths inline in views/TangoView.vue. Two copies of
// seven path commands, because the alternative is a build step to share an SVG
// between a React Native renderer and a Vue template, and the shape is fixed.
export default function TangoDancers({
  size = 18,
  color,
}: {
  size?: number;
  color: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round">
      {/* heads, tilted towards each other */}
      <Circle cx={8.4} cy={4.3} r={2.3} fill={color} stroke="none" />
      <Circle cx={15.8} cy={3.6} r={2.3} fill={color} stroke="none" />
      {/* torsos, leaning in to meet */}
      <Path d="M8.7 7.4 L 11.6 13" />
      <Path d="M15.5 6.7 L 12.6 13" />
      {/* her weight leg, and his extended one */}
      <Path d="M11.4 13 L 8 21" />
      <Path d="M12.8 13 L 19.6 19.4" />
      {/* the hold */}
      <Path d="M5.2 9.6 C 9.4 6.5 14.6 6.1 18.4 8.8" />
    </Svg>
  );
}
