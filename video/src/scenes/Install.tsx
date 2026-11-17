import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono, sans } from "../theme";

const COMMAND = "/plugin install esitimaty --marketplace P0r0ro/Esitimaty";

export const Install = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const typed = Math.floor(
    interpolate(frame, [0.4 * fps, 2.4 * fps], [0, COMMAND.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const isTyping = typed < COMMAND.length;
  const caretOn = Math.floor(frame / (fps / 2)) % 2 === 0;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.bg,
        fontFamily: sans,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        gap: 56,
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3, color: C.text }}>
        One line to <span style={{ color: C.accent }}>install.</span>
      </div>

      <div
        style={{
          width: 1660,
          backgroundColor: C.panel,
          border: `2px solid ${C.border}`,
          borderRadius: 24,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", gap: 12, padding: "20px 26px", borderBottom: `2px solid ${C.border}` }}>
          {[C.error, C.warning, C.success].map((c) => (
            <div key={c} style={{ width: 18, height: 18, borderRadius: 999, backgroundColor: c, opacity: 0.8 }} />
          ))}
        </div>
        <div style={{ padding: "40px 48px", fontFamily: mono, fontSize: 38, lineHeight: 1.6 }}>
          <div style={{ color: C.text }}>
            <span style={{ color: C.accent }}>&gt; </span>
            {COMMAND.slice(0, typed)}
            <span style={{ opacity: isTyping || caretOn ? 1 : 0, color: C.accent }}>▌</span>
          </div>
          <div
            style={{
              color: C.success,
              opacity: interpolate(frame, [2.8 * fps, 3.1 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            ✓ Installed esitimaty. Plugin is now active.
          </div>
        </div>
      </div>

      <div
        style={{
          fontFamily: mono,
          fontSize: 44,
          color: C.dim,
          opacity: interpolate(frame, [3.4 * fps, 3.9 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [3.4 * fps, 4 * fps], ["0px 20px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        github.com/<span style={{ color: C.text }}>P0r0ro/Esitimaty</span>
        <span style={{ fontFamily: sans, fontSize: 32, color: C.subtle }}> · MIT · open source</span>
      </div>
    </AbsoluteFill>
  );
};
