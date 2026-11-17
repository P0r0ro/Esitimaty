import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono, sans } from "../theme";

const Gauge = ({
  label,
  to,
  detail,
  delay,
}: {
  label: string;
  to: number;
  detail: string;
  delay: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pct = interpolate(frame, [delay * fps, (delay + 2.2) * fps], [0, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 1, 0.68, 1),
  });
  const color = pct >= 85 ? C.error : pct >= 60 ? C.warning : C.success;
  const SEGMENTS = 24;
  const filled = Math.round((pct / 100) * SEGMENTS);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 40, fontWeight: 600, color: C.text }}>{label}</div>
        <div style={{ fontFamily: mono, fontSize: 44, fontWeight: 700, color }}>{Math.round(pct)}%</div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {new Array(SEGMENTS).fill(0).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 30,
              borderRadius: 4,
              backgroundColor: i < filled ? color : C.border,
            }}
          />
        ))}
      </div>
      <div style={{ fontFamily: mono, fontSize: 26, color: C.dim, textAlign: "right" }}>{detail}</div>
    </div>
  );
};

export const Limits = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.bg,
        fontFamily: sans,
        flexDirection: "row",
        alignItems: "center",
        padding: "0 140px",
        gap: 120,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3, color: C.text, lineHeight: 1.05 }}>
          Never hit a <span style={{ color: C.accent }}>wall</span> by surprise.
        </div>
        <div style={{ fontSize: 44, color: C.dim, marginTop: 28, lineHeight: 1.3 }}>
          Context window and your plan's usage limits, with a countdown to every reset.
        </div>
      </div>

      <div
        style={{
          width: 780,
          backgroundColor: C.panel,
          border: `2px solid ${C.border}`,
          borderRadius: 28,
          padding: "48px 56px",
          display: "flex",
          flexDirection: "column",
          gap: 40,
        }}
      >
        <Gauge label="Context" to={41} detail="412K / 1.0M" delay={0.3} />
        <Gauge label="Session (5h)" to={88} detail="resets 2h 10m" delay={0.6} />
        <Gauge label="Weekly (7d)" to={24} detail="resets 4d 3h" delay={0.9} />
      </div>
    </AbsoluteFill>
  );
};
