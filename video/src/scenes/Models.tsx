import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono, sans } from "../theme";

const RATES = [
  { name: "Fable 5.2", input: "$8", output: "$40" },
  { name: "Opus 5.5", input: "$4", output: "$20" },
  { name: "Sonnet 5.5", input: "$2", output: "$10" },
  { name: "Haiku 5.5", input: "$0.10", output: "$0.50" },
];

const Bar = ({
  name,
  tokens,
  usd,
  share,
  delay,
}: {
  name: string;
  tokens: string;
  usd: number;
  share: number;
  delay: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [delay * fps, (delay + 1.2) * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 40, fontWeight: 600, color: C.text }}>{name}</div>
        <div style={{ fontFamily: mono, fontSize: 36 }}>
          <span style={{ color: C.dim }}>{tokens} </span>
          <span style={{ color: C.text, fontWeight: 700 }}>${(usd * p).toFixed(2)}</span>
        </div>
      </div>
      <div style={{ height: 22, backgroundColor: C.border, borderRadius: 999, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(1.2, share * 100) * p}%`,
            backgroundColor: C.accent,
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
};

export const Models = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

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
          Priced <span style={{ color: C.accent }}>per model.</span>
        </div>
        <div style={{ fontSize: 44, color: C.dim, marginTop: 28, lineHeight: 1.3 }}>
          See which model is working, what it charges, and where the money went.
        </div>
        <div
          style={{
            marginTop: 56,
            fontFamily: mono,
            fontSize: 30,
            color: C.dim,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            opacity: interpolate(frame, [1.6 * fps, 2.2 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {RATES.map((r) => (
            <div key={r.name} style={{ display: "flex", gap: 24 }}>
              <span style={{ width: 230, color: C.text }}>{r.name}</span>
              <span style={{ width: 170 }}>{r.input} in</span>
              <span>{r.output} out</span>
            </div>
          ))}
          <div style={{ fontSize: 24, color: C.subtle, fontFamily: sans }}>per million tokens · 22 models priced</div>
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
        <div>
          <div style={{ fontSize: 30, color: C.dim }}>Model</div>
          <div style={{ fontSize: 64, fontWeight: 800, color: C.accent, marginTop: 6 }}>Opus 5.5</div>
          <div style={{ fontFamily: mono, fontSize: 28, color: C.dim, marginTop: 6 }}>
            $4 in · $20 out · $0.20 cache / 1M
          </div>
        </div>
        <div style={{ height: 2, backgroundColor: C.border }} />
        <div style={{ fontSize: 30, color: C.dim }}>By model</div>
        <Bar name="Opus 5.5" tokens="31.9M" usd={23.26} share={0.994} delay={0.4} />
        <Bar name="Haiku 5.5 · subagent" tokens="4.5M" usd={0.14} share={0.006} delay={0.8} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 34 }}>
          <span style={{ color: C.text, fontWeight: 600 }}>Total</span>
          <span style={{ fontFamily: mono, fontWeight: 700, color: C.text }}>
            $
            {interpolate(frame, [0.4 * fps, 2 * fps], [0, 23.4], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }).toFixed(2)}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
