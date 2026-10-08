import { crc32, deflateSync } from "node:zlib"

/** Imagens PNG de mentira para os testes (capas, insígnias e troféus). */

export type Rgb = [number, number, number]

/** Monta um PNG de verdade (RGB, 8 bits), com um degradê de cima para baixo. */
export function makePng(width: number, height: number, top: Rgb, bottom: Rgb): Buffer {
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const t = height > 1 ? y / (height - 1) : 0
    const row = Buffer.alloc(1 + width * 3) // o primeiro byte de cada linha é o filtro (0 = nenhum)
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) row[1 + x * 3 + c] = Math.round(top[c] + (bottom[c] - top[c]) * t)
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bits por cor
  header[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const content = Buffer.concat([Buffer.from(type, "ascii"), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(content))
  return Buffer.concat([length, content, checksum])
}
