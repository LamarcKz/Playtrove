/**
 * Troféus de PS3 de mentira, como o RPCS3 guarda na pasta dele (dev_hdd0/home/<usuário>/trophy/
 * <conjunto>/): a lista dos troféus (TROPCONF.SFM) e o que foi pego (TROPUSR.DAT).
 */

export interface FakeTrophy {
  id: number
  name: string
  detail: string
  /** P = platina, G = ouro, S = prata, B = bronze. */
  grade: "P" | "G" | "S" | "B"
  hidden?: boolean
  /** O id do pacote extra (DLC). */
  group?: string
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** O TROPCONF.SFM (XML), como o RPCS3 deixa depois de instalar os troféus do jogo. */
export function buildTropConf(set: { id: string; title: string; trophies: FakeTrophy[]; groups?: { id: string; name: string }[] }): string {
  return [
    "<!--Sce-Np-Trophy-Signature: 00000000-->",
    '<trophyconf version="1.1">',
    ` <npcommid>${set.id}</npcommid>`,
    " <trophyset-version>01.00</trophyset-version>",
    ` <title-name>${escapeXml(set.title)}</title-name>`,
    ` <title-detail>${escapeXml(set.title)}</title-detail>`,
    ...(set.groups ?? []).map(
      (group) => ` <group id="${group.id}">\n  <name>${escapeXml(group.name)}</name>\n  <detail>${escapeXml(group.name)}</detail>\n </group>`
    ),
    ...set.trophies.map(
      (trophy) =>
        ` <trophy id="${String(trophy.id).padStart(3, "0")}" hidden="${trophy.hidden ? "yes" : "no"}" ttype="${trophy.grade}"` +
        ` pid="${trophy.grade === "P" ? -1 : 0}"${trophy.group ? ` gid="${trophy.group}"` : ""}>\n` +
        `  <name>${escapeXml(trophy.name)}</name>\n  <detail>${escapeXml(trophy.detail)}</detail>\n </trophy>`
    ),
    "</trophyconf>",
  ].join("\n")
}

/** Microssegundos entre 0001-01-01 e 1970-01-01 (o relógio do PS3 conta desde o ano 1). */
const TICK_EPOCH = 62135596800000000n

/** A data no relógio do PS3. */
export function toTick(date: Date): bigint {
  return BigInt(date.getTime()) * 1000n + TICK_EPOCH
}

/**
 * O TROPUSR.DAT: o cabeçalho, as tabelas 4 (o tipo de cada troféu) e 6 (se foi pego e quando), no
 * mesmo formato do RPCS3. `unlocked` diz quando cada troféu foi pego (id → data).
 */
export function buildTropUsr(trophyCount: number, unlocked: Record<number, Date>): Buffer {
  const entry4 = 0x50 + 16
  const entry6 = 0x60 + 16
  const offset4 = 48 + 2 * 32
  const offset6 = offset4 + trophyCount * entry4
  const file = Buffer.alloc(offset6 + trophyCount * entry6)
  file.writeUInt32BE(0x818f54ad, 0)
  file.writeUInt32BE(0x00010000, 4)
  file.writeUInt32BE(2, 8)
  const tables: [number, number, number][] = [
    [4, 0x50, offset4],
    [6, 0x60, offset6],
  ]
  tables.forEach(([type, size, offset], index) => {
    const header = 48 + index * 32
    file.writeUInt32BE(type, header)
    file.writeUInt32BE(size, header + 4)
    file.writeUInt32BE(1, header + 8)
    file.writeUInt32BE(trophyCount, header + 12)
    file.writeBigUInt64BE(BigInt(offset), header + 16)
  })
  for (let id = 0; id < trophyCount; id++) {
    const start4 = offset4 + id * entry4
    file.writeUInt32BE(4, start4)
    file.writeUInt32BE(0x50, start4 + 4)
    file.writeUInt32BE(id, start4 + 8)
    file.writeUInt32BE(id, start4 + 16)
    file.writeUInt32BE(0xffffffff, start4 + 24)

    const start6 = offset6 + id * entry6
    file.writeUInt32BE(6, start6)
    file.writeUInt32BE(0x60, start6 + 4)
    file.writeUInt32BE(id, start6 + 8)
    file.writeUInt32BE(id, start6 + 16)
    const date = unlocked[id]
    if (date) {
      file.writeUInt32BE(1, start6 + 20)
      file.writeBigUInt64BE(toTick(date), start6 + 32)
      file.writeBigUInt64BE(toTick(date), start6 + 40)
    }
  }
  return file
}
