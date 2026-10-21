/**
 * trench-flow's starting point: where its folder lives, the categories and rules a new config starts with, and how
 * the AI prompts describe the person being tracked. All of it can be changed in Settings (or in config.json in the
 * folder); these are only what a fresh install begins with.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Category, Rule } from './types.ts'

/** The data folder when TRENCHFLOW_DIR is not set: ~/.trench-flow. */
export const DEFAULT_DAY_DIR = join(homedir(), '.trench-flow')

/** Who the AI is sorting and describing for (it reads this in the title-sorting and day-summary prompts). */
export const AI_USER = {
  classify: 'for one person (work, study, hobbies and free time)',
  summary: 'for one person',
  /** A good and a bad card title, as the card prompt shows them. */
  titleExample: '"Writing the project proposal in Google Docs", not "Google Docs"',
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'build', name: 'Coding & dev', kind: 'focus', color: 'ink' },
  { id: 'design', name: 'Design & media', kind: 'focus', color: 'plum' },
  { id: 'writing', name: 'Docs & writing', kind: 'focus', color: 'sky' },
  { id: 'research', name: 'Research & reading', kind: 'focus', color: 'teal' },
  { id: 'data', name: 'Spreadsheets & data', kind: 'focus', color: 'sun' },
  { id: 'admin', name: 'Admin & planning', kind: 'focus', color: 'leaf' },
  { id: 'learning', name: 'Learning', kind: 'focus', color: 'sand' },
  { id: 'entertainment', name: 'Entertainment', kind: 'distraction', color: 'rose' },
  { id: 'social', name: 'Social', kind: 'distraction', color: 'orange' },
  { id: 'games', name: 'Games', kind: 'distraction', color: 'red' },
  { id: 'comms', name: 'Comms', kind: 'neutral', color: 'coral' },
  { id: 'personal', name: 'Personal', kind: 'neutral', color: 'stone' },
  { id: 'other', name: 'Other', kind: 'neutral', color: 'slate' },
]

/** Regex rules, first match wins. `app` and `title` are case-insensitive regex sources; both must match when both are set. */
export const DEFAULT_RULES: Rule[] = [
  // games (app names first: a game window title is often just the game name)
  { categoryId: 'games', app: '^(steam|steamwebhelper|epicgameslauncher|battle\\.net|riotclientservices|valorant.*|minecraft.*|javaw|cs2|dota2|fortnite.*|gta5|r5apex|overwatch|leagueclient|league of legends)(\\.exe)?$' },
  { categoryId: 'games', title: '\\b(steam|minecraft|valorant|counter-strike|fortnite|league of legends|apex legends)\\b' },
  // video sites first, so a word in the video's name ("Discord", "Facebook", "Excel") doesn't decide it
  { categoryId: 'learning', title: '\\b(how to|tutorial|course|explained|guide|step by step|lecture)\\b.*\\byoutube\\b' },
  { categoryId: 'entertainment', title: '\\byoutube\\b' },
  // comms
  { categoryId: 'comms', app: '^(discord|telegram|whatsapp|whatsapp\\.root|slack|signal|zoom|teams|ms-teams|messenger|mail|outlook|thunderbird|facetime|messages)(\\.exe)?$' },
  { categoryId: 'comms', title: '(\\bdiscord\\b|telegram|whatsapp|messenger|gmail|outlook|\\binbox\\b|\\bmail\\b|google meet|zoom meeting)' },
  // coding & dev
  { categoryId: 'build', app: '^(code|code - insiders|cursor|windsurf|zed|sublime_text|claude|windowsterminal|wt|terminal|iterm2|powershell|pwsh|cmd|bash|mintty|alacritty|wezterm-gui|devenv|idea64|webstorm64|pycharm64|xcode|android studio|github ?desktop)(\\.exe)?$' },
  { categoryId: 'build', title: '(visual studio code|github|gitlab|bitbucket|claude code|stack ?overflow|localhost:\\d+|\\bnpm\\b|\\bpull request\\b|jira)' },
  // design & media
  { categoryId: 'design', app: '^(figma|photoshop|illustrator|indesign|afterfx|premiere|adobe premiere pro|davinci ?resolve|resolve|blender|gimp|inkscape|affinity.*|sketch|final cut pro|capcut|lightroom)(\\.exe)?$' },
  { categoryId: 'design', title: '(figma|canva|photoshop|illustrator|dribbble|behance|\\bunsplash\\b)' },
  // docs & writing
  { categoryId: 'writing', app: '^(winword|word|microsoft word|pages|notion|obsidian|scrivener|typora)(\\.exe)?$' },
  { categoryId: 'writing', title: '(google docs|docs\\.google|\\.docx?\\b|notion|obsidian|draft|\\bwriting\\b)' },
  // spreadsheets & data
  { categoryId: 'data', app: '^(excel|numbers|tableau)(\\.exe)?$' },
  { categoryId: 'data', title: '(google sheets|sheets\\.google|\\.xlsx?\\b|\\.csv\\b|airtable|analytics|dashboard|looker|metabase)' },
  // admin & planning (including this app)
  { categoryId: 'admin', app: '^(calendar|todoist|things.*|ticktick|reminders)(\\.exe)?$' },
  { categoryId: 'admin', title: '(calendar|todoist|trello|asana|linear|clickup|monday\\.com|invoice|\\bbank\\b|trench-flow)' },
  // research & reading
  { categoryId: 'research', title: '(wikipedia|google scholar|pubmed|arxiv|research|perplexity|\\bdocs\\b|documentation|reference|forum|quora|reddit\\.com/r/)' },
  // learning
  { categoryId: 'learning', app: '^(anki|duolingo)(\\.exe)?$' },
  { categoryId: 'learning', title: '(course|lesson|module \\d|tutorial|udemy|coursera|edx|khan academy|duolingo|skillshare|masterclass|webinar)' },
  // social
  { categoryId: 'social', title: '(facebook|instagram|tiktok|twitter|\\bx\\.com|linkedin|threads|reddit|bluesky|mastodon|pinterest|snapchat)' },
  // entertainment
  { categoryId: 'entertainment', app: '^(spotify|vlc|netflix|primevideo|disney\\+?|music|tv|iina)(\\.exe)?$' },
  { categoryId: 'entertainment', title: '(netflix|twitch|prime video|disney\\+|hbo|hulu|spotify|kick\\.com|9gag|imgur)' },
  // personal: the lock screen, the desktop, the file browser
  { categoryId: 'personal', app: '^(lockapp|searchhost|shellexperiencehost|explorer|finder|loginwindow|screensaverengine)(\\.exe)?$' },
]
