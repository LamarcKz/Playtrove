import { useEffect, useRef, useState } from "react"
import { useI18n } from "@/hooks/useI18n"
import { editFullscreenText, type FullscreenText } from "@/lib/fullscreenText"

interface Props { title: string; initial: string; multiline?: boolean; onApply: (value: string) => void; onCancel: () => void }
const rows = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm", ".,!?;:@#&()-_", "\u00e1\u00e0\u00e2\u00e3\u00e9\u00ea\u00ed\u00f3\u00f4\u00f5\u00fa\u00fc\u00e7"]

/** O rascunho pertence ao editor; Cancelar nunca altera o texto salvo ou a busca anterior. */
export function FullscreenKeyboard({ title, initial, multiline = false, onApply, onCancel }: Props) {
  const { t } = useI18n()
  const [value, setValue] = useState<FullscreenText>({ text: initial, start: initial.length, end: initial.length })
  const [upper, setUpper] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { field.current?.setSelectionRange(value.start, value.end) }, [value])
  const edit = (key: string) => setValue((current) => editFullscreenText(current, key))
  return (
    <div className="fs-keyboard" data-testid="fullscreen-keyboard" onKeyDownCapture={(event) => {
      if ((event.ctrlKey || event.metaKey) && ["a", "c", "v", "x"].includes(event.key.toLowerCase())) { field.current?.focus(); return }
      if ((event.target as HTMLElement).matches("textarea") || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key === "Backspace" || Array.from(event.key).length === 1) {
        event.preventDefault()
        event.stopPropagation()
        edit(event.key === "Backspace" ? "backspace" : event.key)
      }
    }}>
      <h2>{title}</h2>
      <textarea ref={field} aria-label={title} maxLength={10000} rows={multiline ? 5 : 1} value={value.text}
        onSelect={(event) => { const { selectionStart: start, selectionEnd: end } = event.currentTarget; setValue((current) => current.start === start && current.end === end ? current : { ...current, start, end }) }}
        onChange={(event) => setValue({ text: event.target.value, start: event.target.selectionStart, end: event.target.selectionEnd })} />
      <output>{t.fullscreen.textLimit(value.text.length)}</output>
      <div className="fs-keyboard-rows" role="group" aria-label={t.fullscreen.keyboard}>
        {rows.map((row) => <div key={row} className="fs-keyboard-row">{Array.from(row).map((letter) => {
          const key = upper ? letter.toUpperCase() : letter
          return <button type="button" key={letter} aria-label={key} onClick={() => edit(key)}>{key}</button>
        })}</div>)}
        <div className="fs-keyboard-row">
          <button type="button" onClick={() => setUpper(!upper)}>{upper ? t.fullscreen.lowercase : t.fullscreen.uppercase}</button>
          <button type="button" aria-label={t.fullscreen.cursorLeft} onClick={() => edit("left")}>{"←"}</button>
          <button type="button" onClick={() => edit(" ")}>{t.fullscreen.space}</button>
          <button type="button" aria-label={t.fullscreen.cursorRight} onClick={() => edit("right")}>{"→"}</button>
          <button type="button" onClick={() => edit("backspace")}>{t.fullscreen.backspace}</button>
          {multiline && <button type="button" onClick={() => edit("\n")}>{t.fullscreen.lineBreak}</button>}
        </div>
      </div>
      <div className="fs-dialog-actions"><button type="button" onClick={onCancel}>{t.common.cancel}</button><button type="button" className="fs-primary" onClick={() => onApply(value.text)}>{multiline ? t.common.save : t.fullscreen.apply}</button></div>
    </div>
  )
}
