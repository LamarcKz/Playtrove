import { describe, expect, it } from "vitest"
import { releaseBuildEnv } from "../../scripts/release-build-env.mjs"

const home = "C:\\Demo User"
const workspace = "C:\\Demo User\\Projects\\Sample App"
const privacyFlags = [
  "--remap-path-prefix=C:\\Demo User=/build/user",
  "--remap-path-prefix=C:/Demo User=/build/user",
  "--remap-path-prefix=C:\\Demo User\\Projects\\Sample App=/build/app",
  "--remap-path-prefix=C:/Demo User/Projects/Sample App=/build/app",
  "-C",
  "link-arg=/PDBALTPATH:%_PDB%",
]

describe("ambiente da compilação de release", () => {
  it("remapeia perfil e workspace com espaços nas duas formas de barra", () => {
    expect(releaseBuildEnv({}, home, workspace)).toEqual({
      CARGO_ENCODED_RUSTFLAGS: privacyFlags.join("\x1f"),
    })
  })

  it("preserva argumentos codificados com espaços e prioriza-os sobre RUSTFLAGS", () => {
    const env = Object.freeze({
      CARGO_ENCODED_RUSTFLAGS: '--cfg\x1frelease_flavor="demo build"\x1f-C\x1fopt-level=2',
      RUSTFLAGS: "--cfg=ignored",
      CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS: "--cfg=ignored_target",
      CARGO_BUILD_RUSTFLAGS: "--cfg=ignored_build",
    })
    expect(releaseBuildEnv(env, home, workspace)).toEqual({
      CARGO_ENCODED_RUSTFLAGS: ["--cfg", 'release_flavor="demo build"', "-C", "opt-level=2", ...privacyFlags].join("\x1f"),
    })
  })

  it("mantém a precedência de CARGO_ENCODED_RUSTFLAGS mesmo quando vazio", () => {
    expect(releaseBuildEnv({
      CARGO_ENCODED_RUSTFLAGS: "",
      RUSTFLAGS: "--cfg=ignored",
      CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS: "--cfg=ignored_target",
      CARGO_BUILD_RUSTFLAGS: "--cfg=ignored_build",
    }, home, workspace)).toEqual({
      CARGO_ENCODED_RUSTFLAGS: privacyFlags.join("\x1f"),
    })
  })

  it("reaproveita RUSTFLAGS quando não há flags codificadas", () => {
    expect(releaseBuildEnv({ RUSTFLAGS: " \t-C  opt-level=2\t --cfg=release\n " }, home, workspace)).toEqual({
      CARGO_ENCODED_RUSTFLAGS: ["-C", "opt-level=2", "--cfg=release", ...privacyFlags].join("\x1f"),
    })
  })

  it("usa split por espaço e trim do Cargo, sem interpretar aspas", () => {
    expect(releaseBuildEnv({ RUSTFLAGS: ' --cfg="demo build"  -C\topt-level=2 ' }, home, workspace)).toEqual({
      CARGO_ENCODED_RUSTFLAGS: ['--cfg="demo', 'build"', "-C\topt-level=2", ...privacyFlags].join("\x1f"),
    })
  })

  it("reaproveita flags do target Windows x64 antes das flags gerais de build", () => {
    expect(releaseBuildEnv({
      CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS: " --cfg=windows_release\t-C\nopt-level=2 ",
      CARGO_BUILD_RUSTFLAGS: "--cfg=ignored_build",
    }, home, workspace)).toEqual({
      CARGO_ENCODED_RUSTFLAGS: ["--cfg=windows_release", "-C", "opt-level=2", ...privacyFlags].join("\x1f"),
    })
  })

  it("reaproveita CARGO_BUILD_RUSTFLAGS quando não há flags de maior prioridade", () => {
    expect(releaseBuildEnv({ CARGO_BUILD_RUSTFLAGS: " --cfg=build_release\t-C\nopt-level=2 " }, home, workspace)).toEqual({
      CARGO_ENCODED_RUSTFLAGS: ["--cfg=build_release", "-C", "opt-level=2", ...privacyFlags].join("\x1f"),
    })
  })

  it.each([
    ["--cfg=from_rust", ["--cfg=from_rust"]],
    ["", []],
  ] as const)("mantém RUSTFLAGS prioritário sobre target e build, inclusive vazio (%j)", (rustflags, inherited) => {
    expect(releaseBuildEnv({
      RUSTFLAGS: rustflags,
      CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS: "--cfg=ignored_target",
      CARGO_BUILD_RUSTFLAGS: "--cfg=ignored_build",
    }, home, workspace)).toEqual({
      CARGO_ENCODED_RUSTFLAGS: [...inherited, ...privacyFlags].join("\x1f"),
    })
  })

  it.each(["", " \t\n "])("usa o fallback de build quando as flags do target estão vazias (%j)", targetFlags => {
    expect(releaseBuildEnv({
      CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS: targetFlags,
      CARGO_BUILD_RUSTFLAGS: "--cfg=build_release",
    }, home, workspace)).toEqual({
      CARGO_ENCODED_RUSTFLAGS: ["--cfg=build_release", ...privacyFlags].join("\x1f"),
    })
  })

  it("também produz os remapeamentos ao receber caminhos com barras Unix", () => {
    expect(releaseBuildEnv({}, "/demo/user", "/demo/user/project")).toEqual({
      CARGO_ENCODED_RUSTFLAGS: [
        "--remap-path-prefix=\\demo\\user=/build/user",
        "--remap-path-prefix=/demo/user=/build/user",
        "--remap-path-prefix=\\demo\\user\\project=/build/app",
        "--remap-path-prefix=/demo/user/project=/build/app",
        "-C",
        "link-arg=/PDBALTPATH:%_PDB%",
      ].join("\x1f"),
    })
  })
})
