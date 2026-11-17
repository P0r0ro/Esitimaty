import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, sans } from "../theme";

export const Hook = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.bg,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        fontFamily: sans,
        gap: 28,
      }}
    >
      <div
        style={{
          fontSize: 64,
          color: C.dim,
          fontWeight: 400,
          opacity: interpolate(frame, [0, 0.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [0, 0.6 * fps], ["0px 30px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        You built it with Claude.
      </div>
      <div
        style={{
          fontSize: 120,
          color: C.text,
          fontWeight: 800,
          letterSpacing: -3,
          opacity: interpolate(frame, [0.9 * fps, 1.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [0.9 * fps, 1.6 * fps], ["0px 40px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        What did it <span style={{ color: C.accent }}>actually</span> take?
      </div>
    </AbsoluteFill>
  );
};
