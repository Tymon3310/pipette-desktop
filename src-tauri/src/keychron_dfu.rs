// SPDX-License-Identifier: GPL-2.0-or-later
//! The Keychron firmware flasher behind the shim's `keychronDfuFlash`
//! (src/tauri-shim/api/keychron.ts): writes the firmware to a temporary
//! file, waits for the STM32 DFU bootloader (0483:df11) to appear, then
//! flashes it with the system's `dfu-util`, reporting each output line and
//! the progress on [`KEYCHRON_DFU_OUTPUT`].

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::events::emit_all;

/// `IpcChannels.KEYCHRON_DFU_OUTPUT`: a line of output and/or the progress
/// (0 to 1) of a flash.
pub const KEYCHRON_DFU_OUTPUT: &str = "keychron:dfu-output";

/// The STM32 system bootloader the keyboards reboot into.
const DFU_DEVICE: &str = "0483:df11";

/// How long the bootloader may take to appear, and how often it is looked for.
const WAIT_FOR_DEVICE: Duration = Duration::from_secs(60);
const POLL_INTERVAL: Duration = Duration::from_secs(1);

/// Largest firmware accepted (the biggest Keychron MCUs have 1 MiB of flash).
const MAX_FIRMWARE_LEN: usize = 2 * 1024 * 1024;

/// One flash at a time.
static FLASHING: AtomicBool = AtomicBool::new(false);

/// What a flash answered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DfuFlashResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl DfuFlashResult {
    fn ok() -> Self {
        Self { success: true, error: None }
    }

    fn failed(error: impl Into<String>) -> Self {
        Self { success: false, error: Some(error.into()) }
    }
}

/// One event on [`KEYCHRON_DFU_OUTPUT`].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DfuOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
}

impl DfuOutput {
    fn log(line: impl Into<String>) -> Self {
        Self { log: Some(line.into()), progress: None }
    }

    fn progress(progress: f64) -> Self {
        Self { log: None, progress: Some(progress) }
    }
}

/// What a line of dfu-util output shows: erase progress maps onto 5–50 %,
/// download onto 50–100 %; a finished phase also keeps its line. Any other
/// line is shown as it is; empty lines show nothing.
pub fn parse_output_line(line: &str) -> Vec<DfuOutput> {
    let line = line.trim();
    if line.is_empty() {
        return Vec::new();
    }
    let phase = ["Erase", "Download", "Upload"].into_iter().find(|phase| line.starts_with(phase));
    let percent = phase.and_then(|phase| {
        let rest = line[phase.len()..].trim_start();
        let after_bar = rest.strip_prefix('[')?.split_once(']')?.1.trim_start();
        let digits: String = after_bar.chars().take_while(char::is_ascii_digit).collect();
        after_bar[digits.len()..].starts_with('%').then(|| digits.parse::<u32>().ok()).flatten()
    });
    match (phase, percent) {
        (Some(phase), Some(percent)) => {
            let fraction = f64::from(percent.min(100)) / 100.0;
            let overall = if phase == "Erase" { 0.05 + fraction * 0.45 } else { 0.5 + fraction * 0.5 };
            let mut out = vec![DfuOutput::progress(overall)];
            if percent >= 100 {
                out.push(DfuOutput::log(line));
            }
            out
        }
        _ => vec![DfuOutput::log(line)],
    }
}

/// Flashes `data` (the firmware .bin). Fails at once on empty or oversized
/// data and while another flash runs.
#[tauri::command]
pub async fn keychron_dfu_flash<R: Runtime>(app: AppHandle<R>, data: Vec<u8>) -> DfuFlashResult {
    if data.is_empty() || data.len() > MAX_FIRMWARE_LEN {
        return DfuFlashResult::failed("Invalid firmware data");
    }
    if FLASHING.swap(true, Ordering::SeqCst) {
        log::warn!("DFU flash already in progress");
        return DfuFlashResult::failed("Flash already in progress");
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let emit = |output: DfuOutput| emit_all(&app, KEYCHRON_DFU_OUTPUT, output);
        flash(&data, &emit)
    })
    .await
    .unwrap_or_else(|err| DfuFlashResult::failed(format!("The flash stopped: {err}")));
    FLASHING.store(false, Ordering::SeqCst);
    result
}

/// Deletes the temporary firmware file when dropped.
struct TempFile(PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn flash(data: &[u8], emit: &dyn Fn(DfuOutput)) -> DfuFlashResult {
    let path = std::env::temp_dir().join(format!(
        "keychron_firmware_{}_{}.bin",
        std::process::id(),
        pipette_time::now_ms()
    ));
    if let Err(err) = std::fs::write(&path, data) {
        return DfuFlashResult::failed(format!("Failed to write temp firmware file: {err}"));
    }
    let firmware = TempFile(path);

    log::info!("Waiting for the DFU device");
    emit(DfuOutput { log: Some("Waiting for DFU device (up to 60s)...".into()), progress: Some(0.0) });
    if let Err(result) = wait_for_device(emit) {
        return result;
    }

    log::info!("DFU device found, starting flash");
    emit(DfuOutput { log: Some("DFU device found. Starting flash...".into()), progress: Some(0.05) });
    run_dfu_util(&firmware.0, emit)
}

/// Polls `dfu-util -l` until it lists a DFU device.
fn wait_for_device(emit: &dyn Fn(DfuOutput)) -> Result<(), DfuFlashResult> {
    let deadline = Instant::now() + WAIT_FOR_DEVICE;
    loop {
        match Command::new("dfu-util").arg("-l").output() {
            Ok(out) => {
                let text = format!(
                    "{}{}",
                    String::from_utf8_lossy(&out.stdout),
                    String::from_utf8_lossy(&out.stderr)
                );
                if out.status.success() && text.contains("Found DFU") {
                    return Ok(());
                }
            }
            Err(err) => {
                emit(DfuOutput::log(format!("Error running dfu-util: {err}")));
                return Err(DfuFlashResult::failed(format!("dfu-util not found: {err}")));
            }
        }
        if Instant::now() >= deadline {
            emit(DfuOutput::log("Timeout waiting for DFU device"));
            return Err(DfuFlashResult::failed("DFU device did not appear within 60s"));
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Splits on both `\r` and `\n`: dfu-util redraws its progress bar with `\r`.
fn forward_lines(
    source: impl Read + Send + 'static,
    lines: mpsc::Sender<String>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(source);
        let mut chunk = Vec::new();
        loop {
            chunk.clear();
            match reader.read_until(b'\n', &mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    for part in String::from_utf8_lossy(&chunk).split('\r') {
                        if lines.send(part.to_owned()).is_err() {
                            return;
                        }
                    }
                }
            }
        }
    })
}

fn run_dfu_util(firmware: &Path, emit: &dyn Fn(DfuOutput)) -> DfuFlashResult {
    let child = Command::new("dfu-util")
        .args(["--device", DFU_DEVICE, "--alt", "0", "--dfuse-address", "0x08000000:leave", "--download"])
        .arg(firmware)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match child {
        Ok(child) => child,
        Err(err) => {
            log::error!("Error spawning dfu-util: {err}");
            emit(DfuOutput::log(format!("Error spawning dfu-util: {err}")));
            return DfuFlashResult::failed(err.to_string());
        }
    };
    let (sender, lines) = mpsc::channel();
    let readers: Vec<_> = [
        child.stdout.take().map(|out| forward_lines(out, sender.clone())),
        child.stderr.take().map(|err| forward_lines(err, sender.clone())),
    ]
    .into_iter()
    .flatten()
    .collect();
    drop(sender);
    for line in lines {
        for output in parse_output_line(&line) {
            emit(output);
        }
    }
    for reader in readers {
        let _ = reader.join();
    }
    match child.wait() {
        Ok(status) if status.success() => {
            log::info!("DFU flash complete");
            emit(DfuOutput { log: Some("Flash complete.".into()), progress: Some(1.0) });
            DfuFlashResult::ok()
        }
        Ok(status) => {
            let code = status.code().map_or_else(|| "a signal".to_owned(), |code| code.to_string());
            log::error!("DFU flash failed with code {code}");
            emit(DfuOutput::log(format!("dfu-util exited with code {code}")));
            DfuFlashResult::failed(format!("dfu-util exited with code {code}"))
        }
        Err(err) => DfuFlashResult::failed(err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_lines_map_onto_the_overall_progress() {
        assert_eq!(
            parse_output_line("Erase    [=====      ]  40%        40960 bytes"),
            vec![DfuOutput::progress(0.05 + 0.4 * 0.45)]
        );
        assert_eq!(
            parse_output_line("Download [          ]   0%            0 bytes"),
            vec![DfuOutput::progress(0.5)]
        );
        let done = "Download [=========================] 100%        98304 bytes";
        assert_eq!(parse_output_line(done), vec![DfuOutput::progress(1.0), DfuOutput::log(done)]);
    }

    #[test]
    fn other_lines_are_logged_and_empty_ones_dropped() {
        assert_eq!(
            parse_output_line("  Opening DFU capable USB device...\n"),
            vec![DfuOutput::log("Opening DFU capable USB device...")]
        );
        assert!(parse_output_line("   ").is_empty());
        assert_eq!(parse_output_line("Erase done."), vec![DfuOutput::log("Erase done.")]);
    }

    #[test]
    fn events_serialize_without_absent_fields() {
        assert_eq!(
            serde_json::to_value(DfuOutput::progress(0.5)).unwrap(),
            serde_json::json!({ "progress": 0.5 })
        );
        assert_eq!(
            serde_json::to_value(DfuFlashResult::failed("Invalid firmware data")).unwrap(),
            serde_json::json!({ "success": false, "error": "Invalid firmware data" })
        );
        assert_eq!(
            serde_json::to_value(DfuFlashResult::ok()).unwrap(),
            serde_json::json!({ "success": true })
        );
    }

    #[test]
    fn the_event_has_the_name_of_its_ipc_channel() {
        let channels = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/shared/ipc/channels.ts"),
        )
        .unwrap();
        let line = format!("  KEYCHRON_DFU_OUTPUT: '{KEYCHRON_DFU_OUTPUT}',");
        assert!(channels.lines().any(|l| l == line), "channels.ts has no line {line:?}");
    }
}
