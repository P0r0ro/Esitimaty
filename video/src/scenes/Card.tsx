import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, fmtDuration, fmtTokens, mono, sans } from "../theme";

const PHASES = ["Research", "Plan", "Build", "Test", "Ship"];
// Seconds into the scene at which each phase starts; it is done when the next starts.
const STARTS = [0.6, 1.6, 2.4, 4.4, 5.6, 6.3];

const Step = ({ label, i, t }: { label: string; i: number; t: number }) => {
  const start = STARTS[i]!;
  const end = STARTS[i + 1]!;
  const state = t < start ? "idle" : t < end ? "active" : "done";
  const spent = Math.max(0, Math.min(t, end) - start) * 360; // fast-forwarded seconds
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontSize: 26,
              fontWeight: 700,
              backgroundColor: state === "done" ? C.text : "transparent",
              color: state === "done" ? C.bg : state === "active" ? C.accent : C.subtle,
              border: state === "idle" ? `2px solid ${C.subtle}` : "none",
            }}
          >
            {state === "done" ? "✓" : ""}
            {state === "active" && (
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: `4px solid ${C.border}`,
                  borderTopColor: C.accent,
                  borderRightColor: C.accent,
                  rotate: `${t * 540}deg`,
                }}
              />
            )}
          </div>
          <div
            style={{
              fontSize: 34,
              fontWeight: state === "idle" ? 400 : 600,
              color: state === "idle" ? C.subtle : C.text,
            }}
          >
            {label}
          </div>
        </div>
        <div
          style={{
            fontSize: 28,
            fontFamily: mono,
            color: state === "active" ? C.accent : C.dim,
          }}
        >
          {state === "idle" ? "—" : state === "done" ? `Done · ${fmtDuration(spent)}` : fmtDuration(spent)}
        </div>
      </div>
      {i < PHASES.length - 1 && (
        <div style={{ width: 2, height: 18, backgroundColor: C.border, marginLeft: 21 }} />
      )}
    </div>
  );
};

const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
    <div style={{ fontSize: 30, color: bold ? C.text : C.dim, fontWeight: bold ? 600 : 400 }}>{label}</div>
    <div style={{ fontSize: 32, fontFamily: mono, fontWeight: 700, color: C.text }}>{value}</div>
  </div>
);

export const Card = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const progress = interpolate(t, [0.6, 6.3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const isWorking = t >= 0.6 && t < 6.3;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.bg,
        fontFamily: sans,
        flexDirection: "row",
        alignItems: "center",
        padding: "0 140px",
        gap: 110,
      }}
    >
      <div style={{ flex: 1, position: "relative", height: 400 }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: -3,
            color: C.text,
            lineHeight: 1.05,
            opacity: interpolate(frame, [0, 0.4 * fps, 3.4 * fps, 3.8 * fps], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          Every phase,
          <br />
          <span style={{ color: C.accent }}>timed.</span>
          <div style={{ fontSize: 44, fontWeight: 400, color: C.dim, letterSpacing: 0, marginTop: 28 }}>
            Research, plan, build, test, ship — worked out from what Claude actually runs.
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            top: 0,
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: -3,
            color: C.text,
            lineHeight: 1.05,
            opacity: interpolate(frame, [3.8 * fps, 4.2 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          Time, cost,
          <br />
          tokens. <span style={{ color: C.accent }}>Live.</span>
          <div style={{ fontSize: 44, fontWeight: 400, color: C.dim, letterSpacing: 0, marginTop: 28 }}>
            Including the time Claude really spent working.
          </div>
        </div>
      </div>

      <div
        style={{
          width: 760,
          backgroundColor: C.panel,
          border: `2px solid ${C.border}`,
          borderRadius: 28,
          padding: "44px 52px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          translate: interpolate(frame, [0, 0.7 * fps], ["0px 60px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          opacity: interpolate(frame, [0, 0.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 26 }}>
          <div style={{ fontSize: 30, color: C.dim }}>Progress</div>
          <div style={{ fontSize: 28, fontFamily: mono, color: isWorking ? C.accent : C.dim }}>
            {isWorking ? "● working" : "idle"}
          </div>
        </div>
        {PHASES.map((p, i) => (
          <Step key={p} label={p} i={i} t={t} />
        ))}
        <div style={{ height: 30 }} />
        <Row label="Time spent" value={fmtDuration(progress * 3055)} />
        <Row label="Claude working" value={fmtDuration(progress * 2460)} />
        <div style={{ height: 16 }} />
        <Row label="AI cost (estimate)" value={`about $${(progress * 148.19).toFixed(2)}`} bold />
        <div style={{ fontSize: 22, color: C.subtle, marginTop: 4 }}>
          The coding agent's estimate at API prices, not your bill.
        </div>
        <div style={{ height: 16 }} />
        <Row label="Tokens" value={fmtTokens(progress * 115_400_000)} />
      </div>
    </AbsoluteFill>
  );
};
