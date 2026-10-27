import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { FullscreenInput, scrollFullscreenText, type FullscreenAction } from "@/lib/fullscreenNavigation"

/** O foco nativo é obrigatório; DOM e visibilidade só podem suspender, nunca o substituir. */
export function useFullscreenActive() {
  const [active, setActive] = useState(false)
  useEffect(() => {
    let listening = true
    let received = false
    let nativeFocused = false
    let focused = document.hasFocus()
    const update = () => { if (listening) setActive(nativeFocused && focused && !document.hidden) }
    const focus = () => { focused = true; update() }
    const blur = () => { focused = false; update() }
    const visibility = () => { focused = document.hasFocus(); update() }
    const receive = (state: { isFocused: boolean }) => {
      nativeFocused = state.isFocused
      focused = document.hasFocus()
      update()
    }
    const stop = window.api.windowControls.onStateChange((state) => { received = true; receive(state) })
    void window.api.windowControls.getState().then((state) => {
      if (listening && !received) receive(state)
    }).catch(() => { /* Sem confirmação nativa, input e mídia permanecem suspensos. */ })
    window.addEventListener("focus", focus)
    window.addEventListener("blur", blur)
    document.addEventListener("visibilitychange", visibility)
    update()
    return () => {
      listening = false
      stop()
      window.removeEventListener("focus", focus)
      window.removeEventListener("blur", blur)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [])
  return active
}
/** Busca o alvo no escopo atual; nunca entrega uma ação a um painel encoberto. */
export function moveFullscreenFocus(scope: HTMLElement, direction: FullscreenAction) {
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex='0']")).filter((node) => node.getClientRects().length > 0)
  const current = document.activeElement as HTMLElement
  if (!scope.contains(current)) { candidates[0]?.focus(); return }
  if (current.matches("[data-fs-scroll]") && scrollFullscreenText(current, direction)) return
  const from = current.getBoundingClientRect()
  const horizontal = direction === "left" || direction === "right"
  const sign = direction === "left" || direction === "up" ? -1 : 1
  const x = from.left + from.width / 2
  const y = from.top + from.height / 2
  let best: HTMLElement | undefined
  let distance = Infinity
  for (const candidate of candidates) {
    if (candidate === current) continue
    const rect = candidate.getBoundingClientRect()
    const dx = rect.left + rect.width / 2 - x
    const dy = rect.top + rect.height / 2 - y
    const forward = (horizontal ? dx : dy) * sign
    if (forward < 2) continue
    const score = forward + Math.abs(horizontal ? dy : dx) * 4
    if (score < distance) { distance = score; best = candidate }
  }
  best?.focus()
  best?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" })
}

export function useFullscreenInput(scope: RefObject<HTMLElement | null>, enabled: boolean, context: string, onAction: (action: FullscreenAction) => boolean | void) {
  const input = useRef(new FullscreenInput())
  const action = useRef(onAction)
  action.current = onAction
  const neutral = useRef(false)
  useLayoutEffect(() => { input.current.reset(neutral.current) }, [context, enabled])
  useEffect(() => {
    const dispatch = (actions: FullscreenAction[]) => {
      if (!enabled || !scope.current) return
      for (const event of actions) {
        if (action.current(event)) break
        if (["up", "down", "left", "right"].includes(event)) moveFullscreenFocus(scope.current, event)
        if (event === "cross") {
          const target = document.activeElement as HTMLElement
          if (scope.current.contains(target)) target.click()
        }
      }
    }
    let active = true
    const receive = (snapshot: Parameters<FullscreenInput["update"]>[0]) => {
      const actions = input.current.update(snapshot, performance.now())
      neutral.current = input.current.neutral
      if (enabled) dispatch(actions)
      else input.current.reset()
    }
    const stop = window.api.controllers.onInputChange(receive)
    void window.api.controllers.setInputEnabled(enabled).catch(() => {})
    void window.api.controllers.getInput().then((snapshot) => { if (active) receive(snapshot) }).catch(() => {})
    const timer = window.setInterval(() => dispatch(input.current.repeat(performance.now())), 40)
    const keydown = (event: KeyboardEvent) => {
      if (!enabled || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target as HTMLElement
      const editing = target.matches("textarea,input")
      const keys: Record<string, FullscreenAction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "cross", Escape: "circle", F11: "window" }
      const mapped = keys[event.key]
      if (!mapped || editing && mapped !== "circle" && mapped !== "window") return
      event.preventDefault()
      if (event.repeat && !["up", "down", "left", "right"].includes(mapped)) return
      dispatch([mapped])
    }
    window.addEventListener("keydown", keydown)
    return () => { active = false; stop(); clearInterval(timer); input.current.reset(); window.removeEventListener("keydown", keydown); void window.api.controllers.setInputEnabled(false).catch(() => {}) }
  }, [enabled, scope])
}
