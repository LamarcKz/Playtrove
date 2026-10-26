export interface FullscreenText { text: string; start: number; end: number }
/** Offsets UTF-16 como os campos nativos; movimentos preservam pares surrogate. */
export function editFullscreenText(value: FullscreenText, key: string): FullscreenText {
  let { text, start, end } = value
  const previous = (position: number) => position - (position > 1 && /[\uDC00-\uDFFF]/.test(text[position - 1]) ? 2 : 1)
  const next = (position: number) => position + (/[\uD800-\uDBFF]/.test(text[position] ?? "") ? 2 : 1)
  if (key === "left") start = end = Math.max(0, start !== end ? start : previous(start))
  else if (key === "right") start = end = Math.min(text.length, start !== end ? end : next(end))
  else {
    if (key === "backspace" && start === end) start = Math.max(0, previous(start))
    const insertion = key === "backspace" ? "" : key
    if (text.length - (end - start) + insertion.length > 10000) return value
    text = text.slice(0, start) + insertion + text.slice(end)
    start = end = start + insertion.length
  }
  return { text, start, end }
}
