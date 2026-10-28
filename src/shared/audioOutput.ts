/** Uma saída de reprodução ativa do Windows. O id opaco só identifica o endpoint. */
export interface AudioOutputDevice {
  id: string
  name: string
  isDefault: boolean
}

/** Volume geral da saída padrão do Windows, separado do volume da música do app. */
export interface AudioOutputState {
  devices: AudioOutputDevice[]
  volume: number
  muted: boolean
}
