import { createHash } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { crc32 } from "node:zlib"

/** Um PNG de 1×1, para a imagem do pacote carregar de verdade pelo protocolo do tema. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")

function silentWav() {
  const data = Buffer.alloc(44 + 800)
  data.write("RIFF")
  data.writeUInt32LE(data.length - 8, 4)
  data.write("WAVEfmt ", 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(8000, 24)
  data.writeUInt32LE(16000, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write("data", 36)
  data.writeUInt32LE(800, 40)
  return data
}

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
  /** As variáveis que fazem o app baixar estes pacotes no lugar das páginas oficiais. */
  env: Record<string, string>
  /** Quantas vezes o tema foi baixado. */
  downloads: () => number
  close: () => Promise<void>
}

/**
 * Os quatro pacotes do Aniki de mentira, na ordem do app: o Playnite (aqui um .zip; o app reconhece
 * o .7z de verdade pelos primeiros bytes), o tema, com mídias sintéticas (nada do pacote de verdade),
 * o Aniki Helper e o IGDB.
 */
export async function startFakeAnikiPack(options: { wrongHash?: boolean } = {}): Promise<FakeAnikiPack> {
  const pictures = [
    "Images/Back.png", "Images/Plat.png", "Images/Or.png", "Images/Argent.png", "Images/Bronze.png",
    "Images/UserLevel/Bronze1.png", "Icons/Source/Sony Playstation.png", "Icons/Source/Sony Playstation 2.png",
    "Themes Option/3.Avatar/Avatar.png", "Themes Option/3.Avatar/Avatar (2).png",
    ...["A", "B", "X", "Y", "LS", "RS", "Start", "Back", "LeftShoulder", "RightShoulder"].map((button) => `Images/Buttons/Controller/PlayStation/Button-${button}.png`),
    ...["A", "B", "X", "Y", "LS", "RS", "Start", "Back", "LeftShoulder", "RightShoulder"].map((button) => `Images/Buttons/Controller/PlayStation/Playstation Dark/Button-${button}.png`),
  ]
  const theme = zip({
    "theme.yaml": Buffer.from("Id: Aniki_ReMake_bb8728bd-ac83-4324-88b1-ee5c586527d1"),
    ...Object.fromEntries(pictures.map((path) => [path, PIXEL])),
    ...Object.fromEntries(["navigation", "activation", "OpenPanel", "OpenAdditionalView", "CloseAdditionalView", "EnterGameDetails", "ExitGameDetails", "HomeHubOpen", "HomeHubClose", "ChangeDisplay"].map((name) => [`audio/${name}.wav`, silentWav()])),
    ...Object.fromEntries(["LoginOST", "HubOST", "SecondaryViewsOST", "ScreenSaverOST"].map((name) => [`audio/${name}.mp3`, silentWav()])),
    "Views/Main.xaml": Buffer.from("<Grid />"),
  })
  const packages = [
    zip({ "Playnite.FullscreenApp.exe": Buffer.from("exe"), "Playnite.DesktopApp.exe": Buffer.from("exe") }),
    theme,
    zip({ "extension.yaml": Buffer.from("Id: AnikiHelper_96a983a3-3f13-4dce-a474-4052b718bb52") }),
    zip({ "extension.yaml": Buffer.from("Id: IGDBMetadata_Builtin") }),
  ]
  let downloads = 0
  const server = createServer((request, response) => {
    const index = Number(/^\/pacote-(\d)$/.exec(request.url ?? "")?.[1])
    const pack = packages[index]
    if (!pack) {
      response.writeHead(404).end()
      return
    }
    if (index === 1) downloads++
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": pack.length }).end(pack)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  const sources = packages.map((pack, index) => ({
    url: `http://127.0.0.1:${port}/pacote-${index}`,
    sha256: options.wrongHash && index === 1 ? "0".repeat(64) : createHash("sha256").update(pack).digest("hex"),
  }))
  return {
    env: { PLAYTROVE_ANIKI_PACKAGES: JSON.stringify(sources) },
    downloads: () => downloads,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
