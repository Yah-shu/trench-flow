/**
 * Windows screenshots use ffmpeg (server/day/capture.ts reads FFMPEG_PATH, else `ffmpeg` on PATH). A program
 * started at login doesn't always see a PATH that was changed by an install a minute earlier, so this looks in the
 * places the installer puts it and sets FFMPEG_PATH when it finds one. macOS needs nothing (screencapture is built in).
 */
import { existsSync, readdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export function findFfmpeg(env: Record<string, string | undefined> = process.env, appDir = process.cwd()): string | null {
  if (env.FFMPEG_PATH && existsSync(env.FFMPEG_PATH)) return env.FFMPEG_PATH
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const places = (env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, exe))
  if (process.platform === 'win32') {
    const local = env.LOCALAPPDATA ?? ''
    places.push(join(local, 'Microsoft', 'WinGet', 'Links', exe))
    // winget's portable packages: ...\WinGet\Packages\Gyan.FFmpeg_<source>\ffmpeg-<version>\bin\ffmpeg.exe
    const pkgs = join(local, 'Microsoft', 'WinGet', 'Packages')
    try {
      for (const p of readdirSync(pkgs).filter((n) => /^Gyan\.FFmpeg/i.test(n))) {
        for (const v of readdirSync(join(pkgs, p))) places.push(join(pkgs, p, v, 'bin', exe))
      }
    } catch {
      // no winget packages folder
    }
    // the installer's own copy when winget isn't there: <install>\tools\ffmpeg\bin\ffmpeg.exe, beside app\
    places.push(join(appDir, '..', 'tools', 'ffmpeg', 'bin', exe))
  } else {
    places.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg')
  }
  return places.find((p) => existsSync(p)) ?? null
}
