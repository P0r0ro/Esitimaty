import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { useVideoConfig } from "remotion";
import { Card } from "./scenes/Card";
import { Hook } from "./scenes/Hook";
import { Install } from "./scenes/Install";
import { Limits } from "./scenes/Limits";
import { Models } from "./scenes/Models";
import { Title } from "./scenes/Title";

export const EsitimatyIntro = () => {
  const { fps } = useVideoConfig();

  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Hook" durationInFrames={3 * fps}>
        <Hook />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
      <TransitionSeries.Sequence name="Title" durationInFrames={3 * fps}>
        <Title />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
      <TransitionSeries.Sequence name="Card" durationInFrames={8 * fps}>
        <Card />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: 15 })}
      />
      <TransitionSeries.Sequence name="Models" durationInFrames={5 * fps}>
        <Models />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: 15 })}
      />
      <TransitionSeries.Sequence name="Limits" durationInFrames={5 * fps}>
        <Limits />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
      <TransitionSeries.Sequence name="Install" durationInFrames={5.5 * fps}>
        <Install />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
