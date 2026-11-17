# Esitimaty intro video

The 27-second intro video in [`docs/`](../docs), made with [Remotion](https://www.remotion.dev).

```sh
npm i                       # install dependencies
npx remotion studio         # preview and edit in the browser
npx remotion render EsitimatyIntro out/esitimaty-intro.mp4
```

If Remotion's own headless Chrome download is slow, use an installed Chrome:
`--browser-executable=/usr/bin/google-chrome`.

To refresh the README GIF from a new render:

```sh
ffmpeg -i out/esitimaty-intro.mp4 -vf "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" out/esitimaty-intro.gif
```

| Scene | File |
| --- | --- |
| Hook: "What did it actually take?" | `src/scenes/Hook.tsx` |
| Title | `src/scenes/Title.tsx` |
| The Progress card | `src/scenes/Card.tsx` |
| Priced per model | `src/scenes/Models.tsx` |
| Limits | `src/scenes/Limits.tsx` |
| Install | `src/scenes/Install.tsx` |

Scenes are joined in `src/EsitimatyIntro.tsx`; colors and fonts are in `src/theme.ts`.

Remotion is free for individuals and companies of up to 3 people; see [remotion.dev/license](https://www.remotion.dev/license).
