import { Composition } from "remotion";
import { EsitimatyIntro } from "./EsitimatyIntro";

// Scenes: 3 + 3 + 8 + 5 + 5 + 5.5 s at 30 fps = 885 frames,
// less the five transitions' overlaps (12 + 12 + 15 + 15 + 12 = 66) = 819 frames.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="EsitimatyIntro"
        component={EsitimatyIntro}
        durationInFrames={819}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
