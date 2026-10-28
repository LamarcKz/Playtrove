import { createHash } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { crc32 } from "node:zlib"

/** Um PNG de 1×1, para a imagem do pacote carregar de verdade pelo protocolo do tema. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")

/** Um .zip sem compressão, montado à mão (o formato do .pthm do Playnite). */
function zip(files: Record<string, Buffer>) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name, "utf8")
    const checksum = crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(filename.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(content.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(filename.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, filename, content)
    centrals.push(central, filename)
    offset += local.length + filename.length + content.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

export interface FakeAnikiPack {
  /** As variáveis que fazem o app baixar este pacote no lugar da release oficial. */
  env: Record<string, string>
  /** Quantas vezes o pacote foi baixado. */
  downloads: () => number
  close: () => Promise<void>
}

/** O pacote do tema Aniki de mentira, com mídias sintéticas (nada do pacote de verdade). */
export async function startFakeAnikiPack(options: { wrongHash?: boolean } = {}): Promise<FakeAnikiPack> {
  const pack = zip({
    "Images/Back.png": PIXEL,
    "audio/navigation.wav": Buffer.from("RIFF"),
    "Views/Main.xaml": Buffer.from("<Grid />"),
  })
  let downloads = 0
  const server = createServer((request, response) => {
    if (request.url !== "/aniki.pthm") {
      response.writeHead(404).end()
      return
    }
    downloads++
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": pack.length }).end(pack)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    env: {
      PLAYTROVE_ANIKI_PACK_URL: `http://127.0.0.1:${port}/aniki.pthm`,
      PLAYTROVE_ANIKI_PACK_SHA256: options.wrongHash ? "0".repeat(64) : createHash("sha256").update(pack).digest("hex"),
    },
    downloads: () => downloads,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
