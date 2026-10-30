/** Mídias do pacote oficial instalado, servidas pelo protocolo restrito do tema. */
export function anikiAsset(path: string): string {
  return `http://playtrove-theme.localhost/aniki/${path.split("/").map(encodeURIComponent).join("/")}`
}
