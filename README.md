# trench-flow

**See where your day went.** trench-flow is a private time tracker for Windows and macOS. It watches which window is
in front (through [ActivityWatch](https://activitywatch.net)), sorts your time into categories like coding, writing,
design, social media or games, and shows your day as a timeline with a focus ring, targets and a 7-day view.

If you want, it can also use **your own Claude plan** to give each block of time a short title, write a day
summary, answer questions about your day ("where did my afternoon go?") and write a morning standup. That part is
optional: with the AI set to **Off**, everything else works and nothing leaves your computer.

<!-- Screenshots: add images to docs/ and link them here. -->
> Screenshots coming soon.

---

## Install

Pick one of the three ways. All of them install the same thing, need no admin password, and can be run again later
to update (your data is kept).

### a) Ask your AI assistant to do it

If you use an AI coding assistant on your computer (Claude Code, Codex, Cursor or similar), paste this to it:

> Install trench-flow from https://github.com/Yah-shu/trench-flow and set it up for me

It will follow [AGENTS.md](AGENTS.md), which has the exact steps, and walk you through the few clicks only you can do.

### b) One line

**Windows 10/11** — open **PowerShell** (Start menu → type "PowerShell") and paste:

```powershell
irm https://raw.githubusercontent.com/Yah-shu/trench-flow/main/install.ps1 | iex
```

**macOS** — open **Terminal** (Spotlight → type "Terminal") and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/Yah-shu/trench-flow/main/install.sh | bash
```

The installer gets what is missing (Bun, ActivityWatch, and on Windows ffmpeg for the optional screenshots),
downloads trench-flow, sets it to start hidden when you log in, adds a **trench-flow** shortcut (Start menu and
desktop on Windows, `~/Applications` on macOS) and opens it.

**On macOS, two switches are yours to turn on** (the installer opens the right screen; macOS doesn't let a script do it):

1. *System Settings → Privacy & Security → Accessibility*: switch on **ActivityWatch**. Without it, ActivityWatch
   can't see window titles.
2. *System Settings → Privacy & Security → Screen Recording*: only if you turn on screenshots in trench-flow. Add
   **bun** (the installer prints where it is) and switch it on.

### c) By hand

1. Install [Bun](https://bun.sh) and [ActivityWatch](https://activitywatch.net/downloads/) (start ActivityWatch and
   let it start at login). On Windows, install [ffmpeg](https://ffmpeg.org/download.html) if you want screenshots.
2. Download this repository ([zip](https://github.com/Yah-shu/trench-flow/archive/refs/heads/main.zip)) and unzip it.
3. In that folder run:
   ```
   bun install
   bun run build
   bun start
   ```
4. Open http://127.0.0.1:7766 if a window didn't open by itself.

### After installing (optional)

- **Websites:** install the ActivityWatch browser extension
  [aw-watcher-web](https://github.com/ActivityWatch/aw-watcher-web#installation) (Chrome, Edge, Firefox) so trench-flow
  knows which site a browser tab is on, not only its title.
- **AI:** install [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and sign in once:
  - Windows: `irm https://claude.ai/install.ps1 | iex`, then run `claude`
  - macOS: `curl -fsSL https://claude.ai/install.sh | bash`, then run `claude`

  Then pick an AI level in trench-flow's **Settings**. Without Claude Code, leave it on **Off**; the app works fully.

---

## AI levels

trench-flow uses Claude Haiku (the smallest, cheapest model) through the Claude Code command-line tool, on **your own
Claude plan** — there is no account, key or server of ours. You choose how much it does in **Settings → AI level**:

| Level | What it does | Rough use per day |
| --- | --- | --- |
| **Off** | No AI at all, free. Your rules, your own labels and the local look-alike matcher sort the day. No card titles, summary, chat or standup. | 0 |
| **Low** | Window titles only, no screenshots. Cards named every 2 hours. | ~10–20k Haiku tokens |
| **Medium** (default) | Screenshots only for blocks whose titles say too little. Cards named every hour. | ~25–40k Haiku tokens |
| **High** | Every block is read from 2–4 screenshots. Cards named every 30 minutes. | ~50–80k Haiku tokens |

At API prices that is roughly **$0.02–0.20 a day**; on a Claude subscription it comes out of your plan's usage.
trench-flow checks your weekly usage and **stops the AI by itself at 93%** of your weekly limit, so it never eats
the last of your plan (on macOS, where Claude Code keeps its login in the Keychain, this check can't run and the AI
simply carries on; set the level to Off or Low if that worries you). Screenshots are only sent when they are turned
on in Settings *and* the level is Medium or High.

The default is Medium, but if `claude` isn't installed nothing is sent and the AI parts just say they can't run;
choose **Off** to hide them.

## Privacy

- **Everything stays on your computer.** Your data lives in `~/.trench-flow` (on Windows
  `%USERPROFILE%\.trench-flow`): settings, day files, the labels you set, screenshots and logs. The app only listens
  on `127.0.0.1` and refuses requests from other websites.
- **What goes to Claude (only when the AI level isn't Off):** window titles, website names and times, and at
  Medium/High a few small screenshots (only when screenshots are on). Emails and long numbers in titles are masked
  first. Nothing else.
- **Private apps and titles:** in Settings you can list apps and title patterns that are never sent anywhere and
  never screenshotted (password managers and online banking are on the list from the start). Their time still counts,
  as "(private)".
- **Nothing is taken while you're away**, on the lock screen, or when a private window is in front.
- **Screenshots are off by default.** When on, they are kept for 7 days (you choose 1–60) and then deleted.
- The weekly usage check reads Claude Code's own login token from `~/.claude/.credentials.json` and sends it only
  to Anthropic's usage endpoint (`api.anthropic.com`). It is never stored or logged. `TRENCHFLOW_SKIP_USAGE=1` turns
  the check off.
- The optional local look-alike matcher downloads a small model (all-MiniLM-L6-v2, ~23 MB) from Hugging Face once;
  it then runs on your computer and sends nothing.

## How it compares to Dayflow

trench-flow is inspired by [Dayflow](https://github.com/JerryZLiu/Dayflow), the lovely private work journal for Mac.
It is **not affiliated with Dayflow, and no Dayflow code is used**; it was written separately on top of ActivityWatch.

| | Dayflow | trench-flow |
| --- | --- | --- |
| Platforms | macOS | Windows and macOS |
| What it reads | Screen recordings, analysed by an AI | Window titles and websites from ActivityWatch; screenshots optional |
| Without AI | Needs an AI provider (cloud or local model) | Works fully at Off: rules, your labels, a local look-alike matcher |
| AI | Your choice of provider | Claude Haiku on your own Claude plan, with an automatic stop near the weekly cap |
| Several computers | One Mac | Any number of devices through ActivityWatch sources (see below) |
| Timeline, standup, chat, weekly view | Yes | Yes |

## Several devices

Each computer runs its own ActivityWatch. trench-flow can read several of them and merge them into one day (never
counting the same minute twice). Add the other device to `sources` in `~/.trench-flow/config.json` and restart
trench-flow:

```json
"sources": [
  { "id": "desktop", "name": "Desktop", "kind": "desktop", "url": "http://127.0.0.1:5600" },
  { "id": "laptop", "name": "Laptop", "kind": "mac", "url": "http://<the laptop's private address>:5600" }
]
```

ActivityWatch only listens on its own computer by default; to reach it from another one, use a private network between
your devices (for example a VPN such as Tailscale or WireGuard, or an SSH tunnel). Don't open ActivityWatch's port to
the internet. Screenshots and nudges only ever come from the computer trench-flow runs on.

## Update and uninstall

**Update:** run the install line again. Your settings and history are kept.

**Uninstall:**

- Windows: `irm https://raw.githubusercontent.com/Yah-shu/trench-flow/main/uninstall.ps1 | iex`
- macOS: `curl -fsSL https://raw.githubusercontent.com/Yah-shu/trench-flow/main/uninstall.sh | bash`

This stops trench-flow, removes its shortcuts, its start-at-login entry and its app folder, and **asks** before it
deletes your data. ActivityWatch, Bun and ffmpeg stay installed (remove them like any other app if you want).

## Troubleshooting

| Problem | What to try |
| --- | --- |
| The window doesn't open | Open http://127.0.0.1:7766 in your browser. If that doesn't load either, start trench-flow from its shortcut again. |
| Is it running? | Windows: `irm http://127.0.0.1:7766/api/health` — macOS: `curl http://127.0.0.1:7766/api/health`. It answers `{"ok":true,"app":"trench-flow",...}`. |
| The page shows "sample data" | trench-flow's server isn't answering; start it from its shortcut. The log is in `~/.trench-flow/logs/server.log`. |
| The day is empty / the device shows offline | ActivityWatch isn't running. Start it (Windows: Start menu → ActivityWatch; macOS: Applications → ActivityWatch). Check http://127.0.0.1:5600. |
| macOS: apps show but no window titles | Turn on Accessibility for ActivityWatch (System Settings → Privacy & Security → Accessibility), then restart ActivityWatch. |
| macOS: screenshots are only the desktop background | Turn on Screen Recording for `bun` (see Install), then restart trench-flow. |
| Windows: no screenshots | Check `ffmpeg -version` in PowerShell. Run the installer again, or set `FFMPEG_PATH` in a `.env` file in the app folder. |
| AI: "could not start Claude Code" | Install Claude Code and run `claude` once to sign in (see above), or set the AI level to Off. |
| AI: "skipped to save your Claude usage" | Your plan is at 93% of its weekly limit; the AI comes back after your weekly reset. |
| Port 7766 is taken | Put `TRENCHFLOW_PORT=7800` in a `.env` file in the app folder (Windows `%LOCALAPPDATA%\trench-flow\app`, macOS `~/.local/share/trench-flow/app`) and restart. |

More settings are in [.env.example](.env.example).

## For developers

```
bun install
bun run dev        # server on :7766 with reload, page on :7767
bun run test       # tests (the AI is always mocked; nothing calls Claude)
bun run typecheck
bun run build      # the page into dist/, served by `bun start`
```

`server/` is the Bun + Hono server (`server/day/` is the tracker: ActivityWatch reader, rules, cards, AI calls,
screenshots, nudges); `board/` is the React page. `bun run add-matcher` installs the optional local look-alike matcher.

## License

MIT — see [LICENSE](LICENSE). Third-party parts and their licences are listed in [NOTICE.md](NOTICE.md).
