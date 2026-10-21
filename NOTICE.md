# Notice

trench-flow is MIT-licensed (see [LICENSE](LICENSE)), copyright trench-flow contributors.

It is inspired by [Dayflow](https://github.com/JerryZLiu/Dayflow) by Jerry Liu. trench-flow is not affiliated with
Dayflow and contains no Dayflow code.

## Included in this repository

**Uiverse.io components** by uiverse-astronaut, <https://uiverse.io> — the button, field, card and check styles in
`theme/plinth.css`. Uiverse publishes its components under the MIT licence:

```
MIT License

Copyright (c) uiverse-astronaut

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The icon (`assets/`, `public/icon.svg`) is drawn by code for this project.

## Installed by `bun install` (not included here)

npm packages, each under its own licence: React and React DOM (MIT), Hono (MIT), Lucide icons (ISC), Vite (MIT) and
the test tools. Fonts: Inter and Space Grotesk (SIL Open Font License 1.1), through Fontsource.

Optional, with `bun run add-matcher`: Transformers.js (`@huggingface/transformers`, Apache-2.0) with ONNX Runtime
(MIT). It downloads the all-MiniLM-L6-v2 model (Apache-2.0) from Hugging Face on first use.

## Installed separately by the installers (not included here)

[ActivityWatch](https://activitywatch.net) (MPL-2.0), [Bun](https://bun.sh) (MIT), and on Windows
[ffmpeg](https://ffmpeg.org) (GPL builds, from winget or BtbN/FFmpeg-Builds), each under its own licence.
trench-flow talks to ActivityWatch over its local web API and runs ffmpeg as a separate program.

## Services

The optional AI runs through [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on your own Claude account,
under Anthropic's terms.
