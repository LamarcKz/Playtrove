//! Processo oculto confinado a um JobObject; fechar o job encerra também os descendentes.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{Read, Write};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{HANDLE, HANDLE_FLAG_INHERIT, HANDLE_FLAGS, SetHandleInformation, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::Security::SECURITY_ATTRIBUTES;
use windows::Win32::System::JobObjects::{
    CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateProcessW, DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT,
    GetExitCodeProcess, InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOEXW, STARTUPINFOW,
    UpdateProcThreadAttribute, WaitForSingleObject,
};
use windows::core::{PCWSTR, PWSTR};

pub(super) fn run(executable: &Path, args: &[OsString], runtime: &Path, output: File, deadline: Instant) -> Result<(), String> {
    run_limited(executable, args, runtime, output, deadline, super::MAX_VIDEO_BYTES)
}

pub(super) fn run_limited(
    executable: &Path,
    args: &[OsString],
    runtime: &Path,
    output: File,
    deadline: Instant,
    limit: u64,
) -> Result<(), String> {
    let runtime = RuntimeDirectory::new(runtime)?;
    run_with_environment(executable, args, &runtime.path, &environment(&runtime.path), output, deadline, limit)
}

struct RuntimeDirectory {
    root: std::path::PathBuf,
    path: std::path::PathBuf,
}

impl RuntimeDirectory {
    fn new(root: &Path) -> Result<Self, String> {
        if !root.is_absolute() {
            return Err("pasta temporária do downloader inválida".into());
        }
        std::fs::create_dir_all(root).map_err(|_| "não foi possível criar a pasta temporária do downloader")?;
        let root = root.canonicalize().map_err(|_| "pasta temporária do downloader inacessível")?;
        let path = super::tools::temporary_path(&root.join("run"));
        std::fs::create_dir(&path).map_err(|_| "não foi possível preparar a execução do downloader")?;
        if path.canonicalize().map_err(|_| "pasta de execução inacessível")? != path {
            return Err("pasta de execução fora dos dados do app".into());
        }
        Ok(Self { root, path })
    }
}

impl Drop for RuntimeDirectory {
    fn drop(&mut self) {
        // A chamada de processo já encerrou o job e juntou as threads antes deste guard sair.
        // Só remove a subpasta criada por esta execução, nunca o runtime compartilhado.
        for _ in 0..5 {
            if self.path.parent() != Some(self.root.as_path())
                || self.path.canonicalize().ok().as_deref() != Some(self.path.as_path())
            {
                return;
            }
            if std::fs::remove_dir_all(&self.path).is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

fn quote_argument(argument: &OsStr) -> OsString {
    let mut quoted = vec![b'"' as u16];
    let mut slashes = 0;
    for character in argument.encode_wide() {
        if character == b'\\' as u16 {
            slashes += 1;
            continue;
        }
        let count = if character == b'"' as u16 { slashes * 2 + 1 } else { slashes };
        quoted.extend(std::iter::repeat_n(b'\\' as u16, count));
        quoted.push(character);
        slashes = 0;
    }
    quoted.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
    quoted.push(b'"' as u16);
    OsString::from_wide(&quoted)
}

fn environment(runtime: &Path) -> Vec<(OsString, OsString)> {
    let mut values: Vec<(OsString, OsString)> = Vec::new();
    for name in ["SystemRoot", "WINDIR"] {
        if let Some(value) = std::env::var_os(name) {
            values.push((name.into(), value));
        }
    }
    // Não herda proxies, configurações de Python, contas ou caminhos de programas do computador.
    values.extend([
        ("YTDLP_NO_PLUGINS".into(), "1".into()),
        ("DENO_NO_UPDATE_CHECK".into(), "1".into()),
        ("DENO_DIR".into(), runtime.join("deno-cache").into_os_string()),
        ("TEMP".into(), runtime.as_os_str().to_owned()),
        ("TMP".into(), runtime.as_os_str().to_owned()),
        ("PATH".into(), runtime.as_os_str().to_owned()),
    ]);
    values.sort_by_key(|(name, _)| name.to_string_lossy().to_ascii_uppercase());
    values
}

fn run_with_environment(
    executable: &Path,
    args: &[OsString],
    runtime: &Path,
    environment: &[(OsString, OsString)],
    mut output: File,
    deadline: Instant,
    limit: u64,
) -> Result<(), String> {
    if !executable.is_absolute() || !runtime.is_absolute() || Instant::now() >= deadline {
        return Err("processo de trailer inválido ou tempo esgotado".into());
    }
    let error = || "não foi possível iniciar o downloader isolado".to_string();
    // SAFETY: cada handle criado é transferido a OwnedHandle, que o fecha exatamente uma vez.
    let job = own(unsafe { CreateJobObjectW(None, PCWSTR::null()).map_err(|_| error())? });
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: o ponteiro e o tamanho correspondem à estrutura mantida nesta chamada.
    unsafe {
        SetInformationJobObject(
            raw(&job),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of_val(&limits) as u32,
        )
        .map_err(|_| error())?;
    }
    let (mut stdout, stdout_writer) = pipe().map_err(|_| error())?;
    let (mut stderr, stderr_writer) = pipe().map_err(|_| error())?;
    let (stdin, stdin_writer) = pipe().map_err(|_| error())?;
    drop(stdin_writer);
    // SAFETY: somente estes três handles serão herdados; stdin já está em EOF.
    unsafe {
        SetHandleInformation(raw(&stdin), HANDLE_FLAG_INHERIT.0, HANDLE_FLAG_INHERIT).map_err(|_| error())?;
    }
    let inherited = [raw(&stdin), raw(&stdout_writer), raw(&stderr_writer)];
    let jobs = [raw(&job)];
    let attributes = Attributes::new(&inherited, &jobs).map_err(|_| error())?;
    let startup = STARTUPINFOEXW {
        StartupInfo: STARTUPINFOW {
            cb: size_of::<STARTUPINFOEXW>() as u32,
            dwFlags: STARTF_USESTDHANDLES,
            hStdInput: inherited[0],
            hStdOutput: inherited[1],
            hStdError: inherited[2],
            ..Default::default()
        },
        lpAttributeList: attributes.list,
    };
    let application = wide(executable.as_os_str());
    let working = wide(runtime.as_os_str());
    let mut command = quote_argument(executable.as_os_str());
    for argument in args {
        command.push(" ");
        command.push(quote_argument(argument));
    }
    let mut command = wide(&command);
    let mut block = Vec::new();
    for (name, value) in environment {
        block.extend(name.encode_wide());
        block.push(b'=' as u16);
        block.extend(value.encode_wide());
        block.push(0);
    }
    block.push(0);
    let mut information = PROCESS_INFORMATION::default();
    // SAFETY: os buffers UTF-16, a lista de handles e o job vivem até CreateProcessW retornar.
    // JOB_LIST associa o processo antes de executar qualquer código, sem corrida com filhos do PyInstaller.
    unsafe {
        CreateProcessW(
            PCWSTR(application.as_ptr()),
            Some(PWSTR(command.as_mut_ptr())),
            None,
            None,
            true,
            CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
            Some(block.as_ptr().cast()),
            PCWSTR(working.as_ptr()),
            &startup.StartupInfo,
            &mut information,
        )
        .map_err(|_| error())?;
    }
    let process = own(information.hProcess);
    drop(own(information.hThread));
    drop((stdout_writer, stderr_writer, stdin));
    let (sender, receiver) = mpsc::sync_channel(1);
    let reader = std::thread::spawn(move || {
        let result = super::copy_limited(&mut stdout, &mut output, limit)
            .and_then(|_| output.flush().map_err(|_| "falha ao gravar o trailer".to_string()));
        let _ = sender.send(result);
    });
    let diagnostics = std::thread::spawn(move || {
        // Descarta em blocos: não acumula stderr nem deixa o filho bloquear escrevendo nele.
        let mut bytes = [0; 4096];
        while let Ok(count) = stderr.read(&mut bytes) {
            if count == 0 {
                break;
            }
        }
    });
    let mut transferred = false;
    let result = loop {
        if let Ok(result) = receiver.try_recv() {
            match result {
                Ok(()) => transferred = true,
                Err(error) => break Err(error),
            }
        }
        // SAFETY: consulta apenas o handle do processo criado acima, ainda aberto.
        let state = unsafe { WaitForSingleObject(raw(&process), 0) };
        if state == WAIT_OBJECT_0 {
            let mut code = 1;
            // SAFETY: o processo terminou; o ponteiro é o código de saída local.
            if unsafe { GetExitCodeProcess(raw(&process), &mut code) }.is_err() || code != 0 {
                break Err("o downloader não conseguiu obter o trailer".into());
            }
            if transferred {
                break Ok(());
            }
        } else if state != WAIT_TIMEOUT {
            break Err("não foi possível acompanhar o downloader".into());
        }
        if Instant::now() >= deadline {
            break Err("tempo de download do trailer esgotado".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    // SAFETY: termina somente este job, inclusive filhos que ainda seguram pipes abertos.
    unsafe {
        let _ = TerminateJobObject(raw(&job), 1);
        let _ = WaitForSingleObject(raw(&process), 1000);
    }
    let _ = reader.join();
    let _ = diagnostics.join();
    result
}

fn own(handle: HANDLE) -> OwnedHandle {
    // SAFETY: só recebe handles recém-criados, sem outro proprietário Rust.
    unsafe { OwnedHandle::from_raw_handle(handle.0) }
}

fn raw(handle: &impl AsRawHandle) -> HANDLE {
    HANDLE(handle.as_raw_handle())
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain([0]).collect()
}

fn pipe() -> windows::core::Result<(File, OwnedHandle)> {
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        bInheritHandle: true.into(),
        ..Default::default()
    };
    let mut reader = HANDLE::default();
    let mut writer = HANDLE::default();
    // SAFETY: parâmetros de saída locais e estrutura de segurança válida durante a chamada.
    unsafe {
        CreatePipe(&mut reader, &mut writer, Some(&attributes), 0)?;
    }
    let reader = own(reader);
    let writer = own(writer);
    // SAFETY: o leitor pertence ao app; só o escritor será herdado pelo filho.
    unsafe {
        SetHandleInformation(raw(&reader), HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0))?;
    }
    Ok((reader.into(), writer))
}

struct Attributes {
    _storage: Vec<usize>,
    list: LPPROC_THREAD_ATTRIBUTE_LIST,
}

impl Attributes {
    fn new(handles: &[HANDLE], jobs: &[HANDLE]) -> windows::core::Result<Self> {
        let mut size = 0;
        // SAFETY: primeira chamada consulta o tamanho; a segunda recebe memória alinhada suficiente.
        unsafe {
            let _ = InitializeProcThreadAttributeList(None, 2, None, &mut size);
        }
        let mut storage = vec![0usize; size.div_ceil(size_of::<usize>())];
        let list = LPPROC_THREAD_ATTRIBUTE_LIST(storage.as_mut_ptr().cast());
        // SAFETY: buffers apontados são mantidos pelo chamador até CreateProcessW retornar.
        unsafe {
            InitializeProcThreadAttributeList(Some(list), 2, None, &mut size)?;
        }
        let attributes = Self { _storage: storage, list };
        unsafe {
            UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                Some(handles.as_ptr().cast()),
                size_of_val(handles),
                None,
                None,
            )?;
            UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                Some(jobs.as_ptr().cast()),
                size_of_val(jobs),
                None,
                None,
            )?;
        }
        Ok(attributes)
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        // SAFETY: a lista foi inicializada e sua memória ainda pertence a _storage.
        unsafe {
            DeleteProcThreadAttributeList(self.list);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    use std::time::Duration;

    use super::*;
    use crate::test_support::temp_folder;

    const FIXTURE_MODE: &str = "PLAYTROVE_TRAILER_FIXTURE_MODE";
    const FIXTURE_MARKER: &str = "PLAYTROVE_TRAILER_FIXTURE_MARKER";

    fn fixture_args() -> Vec<OsString> {
        // O harness omite o nome do crate, que module_path! inclui.
        let name = concat!(module_path!(), "::subprocess_fixture").split_once("::").unwrap().1;
        ["--exact", name, "--nocapture"].into_iter().map(OsString::from).collect()
    }

    #[test]
    fn caminhos_e_aspas_chegam_como_um_unico_argumento_windows() {
        assert_eq!(quote_argument(OsStr::new("")), "\"\"");
        assert_eq!(quote_argument(OsStr::new(r"D:\Pasta com espaços\")), r#""D:\Pasta com espaços\\""#);
        assert_eq!(quote_argument(OsStr::new(r#"a\"b"#)), r#""a\\\"b""#);
    }

    #[test]
    fn processo_proprio_transfere_stdout_e_codigo_de_erro_nao_vira_sucesso() {
        let root = temp_folder("trailer-processo");
        for (mode, success) in [("success", true), ("failure", false)] {
            let mut env = environment(&root);
            env.push((FIXTURE_MODE.into(), mode.into()));
            let target = root.join(format!("{mode}.bin"));
            let output = File::create(&target).unwrap();
            let result = run_with_environment(
                &std::env::current_exe().unwrap(),
                &fixture_args(),
                &root,
                &env,
                output,
                Instant::now() + Duration::from_secs(10),
                4096,
            );
            assert_eq!(result.is_ok(), success, "{result:?}");
            if success {
                assert!(String::from_utf8_lossy(&std::fs::read(target).unwrap()).contains("trailer de teste"));
            }
        }
    }

    #[test]
    fn timeout_encerra_tambem_o_processo_descendente() {
        use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject};

        let root = temp_folder("trailer-arvore");
        let marker = root.join("descendente.pid");
        let mut env = environment(&root);
        env.push((FIXTURE_MODE.into(), "tree".into()));
        env.push((FIXTURE_MARKER.into(), marker.as_os_str().to_owned()));
        let output = File::create(root.join("saida.bin")).unwrap();
        assert!(
            run_with_environment(
                &std::env::current_exe().unwrap(),
                &fixture_args(),
                &root,
                &env,
                output,
                Instant::now() + Duration::from_secs(5),
                4096
            )
            .is_err()
        );
        let pid: u32 = std::fs::read_to_string(marker).expect("o descendente chegou a iniciar").parse().unwrap();
        // SAFETY: consulta somente o processo de teste cujo PID foi escrito na pasta temporária.
        unsafe {
            if let Ok(handle) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
                let status = WaitForSingleObject(handle, 1000);
                let _ = CloseHandle(handle);
                assert_eq!(status, WAIT_OBJECT_0);
            }
        }
    }

    #[test]
    fn timeout_remove_tambem_a_extracao_temporaria_da_ferramenta() {
        let root = temp_folder("trailer-runtime");
        let runtime = root.join("runtime");
        std::fs::create_dir_all(&runtime).unwrap();
        let target = root.join("saida.bin");
        let name = concat!(module_path!(), "::runtime_fixture").split_once("::").unwrap().1;
        let args = ["--exact", name, "--nocapture"].into_iter().map(OsString::from).collect::<Vec<_>>();
        assert!(
            run(
                &std::env::current_exe().unwrap(),
                &args,
                &runtime,
                File::create(&target).unwrap(),
                Instant::now() + Duration::from_secs(5)
            )
            .is_err()
        );
        assert!(String::from_utf8_lossy(&std::fs::read(target).unwrap()).contains("extracao criada"));
        assert_eq!(std::fs::read_dir(runtime).unwrap().count(), 0);
    }

    #[test]
    fn limite_customizado_para_a_musica_interrompe_a_saida_e_limpa_o_runtime() {
        let root = temp_folder("tema-processo-limite");
        let runtime = root.join("runtime");
        let target = root.join("saida.bin");
        let name = concat!(module_path!(), "::runtime_fixture").split_once("::").unwrap().1;
        let args = ["--exact", name, "--nocapture"].into_iter().map(OsString::from).collect::<Vec<_>>();
        let start = Instant::now();
        assert!(
            run_limited(
                &std::env::current_exe().unwrap(),
                &args,
                &runtime,
                File::create(&target).unwrap(),
                start + Duration::from_secs(10),
                8
            )
            .is_err()
        );
        assert_eq!(std::fs::metadata(target).unwrap().len(), 8);
        assert!(start.elapsed() < Duration::from_secs(10));
        assert_eq!(std::fs::read_dir(runtime).unwrap().count(), 0);
    }

    #[test]
    fn runtime_fixture() {
        if !std::env::args().any(|argument| argument == "--exact") || std::env::var("YTDLP_NO_PLUGINS").as_deref() != Ok("1") {
            return;
        }
        let folder = std::env::temp_dir().join("_MEI-trailer-fixture");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("extracao.dll"), b"arquivo sintetico").unwrap();
        std::io::stdout().write_all(b"extracao criada").unwrap();
        std::io::stdout().flush().unwrap();
        loop {
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    #[test]
    fn subprocess_fixture() {
        match std::env::var(FIXTURE_MODE).unwrap_or_default().as_str() {
            "success" => {
                std::io::stdout().write_all(b"trailer de teste").unwrap();
                std::process::exit(0);
            }
            "failure" => std::process::exit(7),
            "tree" => {
                let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                    .args(fixture_args())
                    .env(FIXTURE_MODE, "leaf")
                    .creation_flags(0x08000000)
                    .spawn()
                    .unwrap();
                let _ = child.wait();
                loop {
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
            "leaf" => {
                std::fs::write(std::env::var_os(FIXTURE_MARKER).unwrap(), std::process::id().to_string()).unwrap();
                loop {
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
            _ => {}
        }
    }
}
