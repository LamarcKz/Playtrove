// Opções do build de release, sem alterar o ambiente do processo que chama o script.
export function releaseBuildEnv(env, homeDirectory, workspaceDirectory) {
  const encoded = env.CARGO_ENCODED_RUSTFLAGS
  let flags
  if (encoded !== undefined) {
    flags = encoded ? encoded.split("\x1f") : []
  } else if (env.RUSTFLAGS !== undefined) {
    // O Cargo divide RUSTFLAGS por espaços, aplica trim e não interpreta aspas.
    flags = env.RUSTFLAGS.split(" ").map(flag => flag.trim()).filter(Boolean)
  } else {
    // Este empacotamento gera somente Windows x64; target e build usam whitespace.
    const targetFlags = env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS?.trim()
    flags = (targetFlags || env.CARGO_BUILD_RUSTFLAGS || "").split(/\s+/).filter(Boolean)
  }

  // O último prefixo correspondente vence; o workspace deve vir depois do perfil.
  for (const [directory, target] of [[homeDirectory, "/build/user"], [workspaceDirectory, "/build/app"]]) {
    for (const prefix of new Set([directory.replaceAll("/", "\\"), directory.replaceAll("\\", "/")])) {
      flags.push(`--remap-path-prefix=${prefix}=${target}`)
    }
  }
  flags.push("-C", "link-arg=/PDBALTPATH:%_PDB%")
  return { CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") }
}
