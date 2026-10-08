import { Fragment } from "react"

/**
 * Um texto do dicionário com partes em negrito: o que está entre ** vira <strong> (ex.: "clique em
 * **Salvar**"). Usado nos passos a passo das chaves.
 */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, index) =>
        index % 2 === 1 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>
      )}
    </>
  )
}
