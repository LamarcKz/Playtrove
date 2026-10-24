fn main() {
    // A versão configurada vem deste arquivo; refaz os recursos Win32 quando ela muda.
    println!("cargo:rerun-if-changed=../package.json");
    tauri_build::build()
}
