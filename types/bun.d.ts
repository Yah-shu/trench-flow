// The part of Bun's API the server uses (type-checking runs without bun-types).
declare namespace Bun {
  interface ServeOptions {
    fetch(request: Request): Response | Promise<Response>
    port?: number
    hostname?: string
  }
  interface Server {
    port: number
    stop(closeActiveConnections?: boolean): void
  }
}

declare const Bun: {
  serve(options: Bun.ServeOptions): Bun.Server
}
