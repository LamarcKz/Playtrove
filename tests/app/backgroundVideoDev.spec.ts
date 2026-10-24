import { mkdtempSync } from "node:fs"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium, expect, test, type Browser, type Page } from "@playwright/test"
import { createServer, type ViteDevServer } from "vite"
import { removeDataDir, ROOT } from "./helpers"

// O app dos outros testes usa o bundle compilado. Aqui o Vite serve React em desenvolvimento,
// para exercitar o setup/cleanup/setup extra do StrictMode com o componente e o player reais.
interface BackdropFixture {
  state: { development: boolean; setups: number; cleanups: number }
  mount: (url: string) => void
  clear: () => void
}

let server: ViteDevServer
let browser: Browser
let page: Page
let cacheRoot: string
const errors: string[] = []

const fixtureHtml = `<!doctype html>
<html lang="pt-BR" class="dark">
  <head><title>Playtrove — vídeo em desenvolvimento</title></head>
  <body>
    <div id="root" style="position: relative; height: 600px"></div>
    <script type="module">
      import "/styles/globals.css"
      import { createElement, StrictMode, useEffect } from "react"
      import { createRoot } from "react-dom/client"
      import { I18nProvider } from "/components/I18nProvider.tsx"
      import { GameDetailsBackdrop } from "/components/GameDetailsBackdrop.tsx"
      import { makeGame } from ${JSON.stringify(`/@fs/${resolve(ROOT, "tests/unit/helpers.ts").replaceAll("\\", "/")}`)}

      window.api = { app: { getLanguage: async () => "pt-BR" } }
      const state = { development: import.meta.env.DEV, setups: 0, cleanups: 0 }
      function Probe({ children }) {
        useEffect(() => {
          state.setups++
          return () => { state.cleanups++ }
        }, [])
        return children
      }
      const root = createRoot(document.getElementById("root"))
      window.backdropTest = {
        state,
        mount(url) {
          const game = makeGame({ id: 1, title: "Vídeo de teste", backgroundVideoUrl: url })
          root.render(createElement(StrictMode, null,
            createElement(Probe, null,
              createElement(I18nProvider, null,
                createElement(GameDetailsBackdrop, { key: url, game })))))
        },
        clear() { root.render(null) },
      }
    </script>
  </body>
</html>`

test.beforeAll(async () => {
  cacheRoot = mkdtempSync(join(tmpdir(), "playtrove-video-dev-"))
  const listener = createNetServer()
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve))
  const freeAddress = listener.address()
  if (!freeAddress || typeof freeAddress === "string") throw new Error("Sem porta local disponível")
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  server = await createServer({
    configFile: resolve(ROOT, "vite.config.ts"),
    cacheDir: join(cacheRoot, "node_modules", ".vite"),
    mode: "development",
    server: { host: "127.0.0.1", port: freeAddress.port, strictPort: true, fs: { allow: [ROOT, cacheRoot] } },
    plugins: [{
      name: "background-video-dev-fixture",
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url?.split("?")[0] !== "/__background-video-dev.html") return next()
          void vite.transformIndexHtml("/__background-video-dev.html", fixtureHtml)
            .then((html) => {
              response.setHeader("Content-Type", "text/html; charset=utf-8")
              response.end(html)
            })
            .catch(next)
        })
      },
    }],
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === "string") throw new Error("Vite sem porta local de testes")
  const origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({ channel: "msedge", headless: true })
  page = await browser.newPage({ viewport: { width: 1000, height: 650 }, reducedMotion: "no-preference" })
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.goto(`${origin}/__background-video-dev.html`)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
})

test.afterAll(async () => {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cacheRoot) removeDataDir(cacheRoot)
})

test("React DEV mantém a origem e reproduz após o probe do StrictMode e ao remontar", async () => {
  await expect(page).toHaveTitle("Playtrove — vídeo em desenvolvimento")
  await expect(page.locator("vite-error-overlay")).toHaveCount(0)
  // Mídia só em memória: o navegador grava o próprio canvas, sem rede, arquivo ou biblioteca real.
  const url = await page.evaluate(async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 160
    canvas.height = 90
    const context = canvas.getContext("2d")!
    const stream = canvas.captureStream(12)
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" })
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => chunks.push(event.data)
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
    recorder.start()
    let frame = 0
    const draw = setInterval(() => {
      context.fillStyle = frame++ % 2 ? "#2070b0" : "#104070"
      context.fillRect(0, 0, canvas.width, canvas.height)
    }, 80)
    await new Promise((resolve) => setTimeout(resolve, 650))
    recorder.stop()
    await stopped
    clearInterval(draw)
    stream.getTracks().forEach((track) => track.stop())
    return URL.createObjectURL(new Blob(chunks, { type: "video/webm" }))
  })
  await page.evaluate((url) => (window as unknown as { backdropTest: BackdropFixture }).backdropTest.mount(url), url)
  await expect.poll(() => page.evaluate(() => (window as unknown as { backdropTest: BackdropFixture }).backdropTest.state)).toEqual({
    development: true, setups: 2, cleanups: 1,
  })
  const video = page.locator('[data-slot="game-background-video"]')
  await expect(video).toHaveAttribute("src", url)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState >= 2 && !element.paused && element.currentTime > 0)).toBe(true)
  await expect(video).toBeVisible()
  await expect(video).toHaveCSS("opacity", "1")
  expect(await video.evaluate((element: HTMLVideoElement) => ({ muted: element.muted, loop: element.loop }))).toEqual({ muted: true, loop: true })
  await expect(page.getByRole("button", { name: /vídeo de fundo/i })).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused)).toBe(true)

  const previous = await video.elementHandle()
  await page.evaluate(() => (window as unknown as { backdropTest: BackdropFixture }).backdropTest.clear())
  await expect(video).toHaveCount(0)
  expect(await previous!.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await page.evaluate((url) => (window as unknown as { backdropTest: BackdropFixture }).backdropTest.mount(url), url)
  await expect(video).toHaveAttribute("src", url)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState >= 2 && !element.paused && element.currentTime > 0)).toBe(true)
  expect(errors).toEqual([])
})
