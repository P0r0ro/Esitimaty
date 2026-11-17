import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const { fontFamily: sans } = loadInter("normal", {
  weights: ["400", "600", "800"],
  subsets: ["latin"],
});
export const { fontFamily: mono } = loadMono("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

export const C = {
  bg: "#0b0d10",
  panel: "#13161b",
  border: "#2a2f37",
  text: "#e8e6e3",
  dim: "#8a8f98",
  subtle: "#5d636c",
  accent: "#d97757",
  success: "#4fb477",
  warning: "#e0b341",
  error: "#e05a4f",
};

export const fmtDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};

export const fmtTokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`;
