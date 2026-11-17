import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono, sans } from "../theme";

export const Title = () => {
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
      }}
    >
      <div
        style={{
          fontSize: 200,
          fontWeight: 800,
          letterSpacing: -6,
          color: C.text,
          scale: interpolate(frame, [0, 0.8 * fps], [0.85, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 200 }),
            output: "perceptual-scale",
          }),
          opacity: interpolate(frame, [0, 0.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Esitimaty<span style={{ color: C.accent }}>.</span>
      </div>
      <div
        style={{
          fontSize: 56,
          color: C.dim,
          marginTop: 8,
          opacity: interpolate(frame, [0.5 * fps, 1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        A project monitor for Claude Code
      </div>
      <div
        style={{
          marginTop: 56,
          display: "flex",
          gap: 20,
          fontFamily: mono,
          fontSize: 30,
          opacity: interpolate(frame, [1.1 * fps, 1.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {["time", "cost", "tokens", "model", "limits"].map((w) => (
          <div
            key={w}
            style={{
              padding: "10px 22px",
              border: `2px solid ${C.border}`,
              borderRadius: 999,
              color: C.text,
            }}
          >
            {w}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
