import { app } from "electron"

/** Uma variável de ambiente dos testes automáticos, ou undefined no app instalado (lá elas não valem). */
function testVariable(name: string): string | undefined {
  return app.isPackaged ? undefined : process.env[`PLAYTROVE_${name}`] || undefined
}

/**
 * O que os testes automáticos pedem ao app para rodar sem mexer no computador de verdade. Vem das
 * variáveis de ambiente PLAYTROVE_*, e o app instalado ignora todas elas.
 */
export const testMode = {
  /** Pasta de dados temporária, no lugar da biblioteca de verdade. */
  dataDir: testVariable("DATA_DIR"),
  /** Começar com os 12 jogos de exemplo. */
  sampleGames: testVariable("SAMPLE_GAMES") === "1",
  /** Não procurar os emuladores instalados no PC. */
  skipEmulatorDetection: testVariable("SKIP_EMULATOR_DETECTION") === "1",
  /** O idioma que o Windows finge ter (ex.: "en-US"). */
  systemLanguage: testVariable("SYSTEM_LANGUAGE"),
  /** Endereço do servidor de mentira que faz o papel do IGDB, SteamGridDB, libretro e RetroAchievements. */
  metadataServer: testVariable("METADATA_TEST_SERVER"),
  /** Uma versão nova de mentira (ex.: "9.9.0"), para testar o aviso de atualização sem a internet. */
  fakeUpdate: testVariable("FAKE_UPDATE"),
}
