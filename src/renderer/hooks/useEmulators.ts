import { useEffect, useState } from "react"
import type { EmulatorId, EmulatorInfo, RetroArchCore, RomFolder, ScanResult } from "@shared/types"

/**
 * Os dados da aba Emuladores: os emuladores (o main procura sozinho na primeira vez), os cores do
 * RetroArch e as pastas de ROMs, com as ações de cada um.
 */
export function useEmulators() {
  const [emulators, setEmulators] = useState<EmulatorInfo[] | null>(null)
  const [cores, setCores] = useState<RetroArchCore[]>([])
  const [folders, setFolders] = useState<RomFolder[]>([])

  const loadCores = () => window.api.emulators.cores().then(setCores)
  const loadFolders = () => window.api.romFolders.list().then(setFolders)

  useEffect(() => {
    let active = true
    Promise.all([window.api.emulators.list(), window.api.romFolders.list(), window.api.emulators.cores()]).then(
      ([emulatorList, folderList, coreList]) => {
        if (!active) return
        setEmulators(emulatorList)
        setFolders(folderList)
        setCores(coreList)
      }
    )
    return () => {
      active = false
    }
  }, [])

  return {
    /** null enquanto carrega. */
    emulators,
    cores,
    folders,
    /** Procura de novo os emuladores que ainda não foram encontrados. */
    async detect() {
      setEmulators(await window.api.emulators.detect())
      await loadCores()
    },
    /** Escolhe o executável de um emulador na janela do Windows. */
    async pickPath(id: EmulatorId) {
      setEmulators(await window.api.emulators.pickPath(id))
      if (id === "retroarch") await loadCores()
    },
    async addFolder(folder: Omit<RomFolder, "id">): Promise<RomFolder> {
      const created = await window.api.romFolders.add(folder)
      await loadFolders()
      return created
    },
    async removeFolder(id: number) {
      await window.api.romFolders.remove(id)
      await loadFolders()
    },
    scan(id?: number): Promise<ScanResult> {
      return window.api.romFolders.scan(id)
    },
  }
}
