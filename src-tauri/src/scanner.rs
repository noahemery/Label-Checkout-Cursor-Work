//! USB CDC scanner as a COM port.
//!
//! HID keyboard mode types one character at a time. The printed-roll QR is long
//! enough that Windows drops keys, so the payload never matches. CDC sends the
//! whole decode over a virtual serial port instead.
//!
//! The badge reader stays a keyboard wedge. These commands only open a COM
//! port the supervisor picked — they do not walk every serial device.

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serialport::SerialPortType;
use tauri::{AppHandle, Emitter, State};

const SCAN_EVENT: &str = "cdc-scan";
const STATUS_EVENT: &str = "cdc-status";
const READ_TIMEOUT: Duration = Duration::from_millis(50);
const SILENCE_FLUSH: Duration = Duration::from_millis(80);
const MAX_PAYLOAD: usize = 512;

pub struct ScannerState {
    stop: Mutex<Option<Arc<AtomicBool>>>,
}

impl Default for ScannerState {
    fn default() -> Self {
        Self {
            stop: Mutex::new(None),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerPort {
    pub name: String,
    pub label: String,
}

/// Windows COM1–COM256, optionally with the `\\.\` prefix COM10+ needs.
pub fn is_safe_port(name: &str) -> bool {
    let trimmed = name.trim();
    let core = trimmed
        .strip_prefix(r"\\.\")
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    let digits = match core.strip_prefix("COM") {
        Some(rest) if !rest.is_empty() => rest,
        _ => return false,
    };
    digits.chars().all(|c| c.is_ascii_digit())
}

fn windows_port_path(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.starts_with(r"\\.\") {
        return trimmed.to_string();
    }
    let upper = trimmed.to_ascii_uppercase();
    if let Some(digits) = upper.strip_prefix("COM") {
        if let Ok(n) = digits.parse::<u32>() {
            if n >= 10 {
                return format!(r"\\.\{trimmed}");
            }
        }
    }
    trimmed.to_string()
}

fn usb_label(info: &serialport::SerialPortInfo) -> String {
    match &info.port_type {
        SerialPortType::UsbPort(usb) => {
            let mut bits = Vec::new();
            if let Some(m) = &usb.manufacturer {
                let t = m.trim();
                if !t.is_empty() {
                    bits.push(t.to_string());
                }
            }
            if let Some(p) = &usb.product {
                let t = p.trim();
                if !t.is_empty() {
                    bits.push(t.to_string());
                }
            }
            if bits.is_empty() {
                info.port_name.clone()
            } else {
                format!("{} — {}", info.port_name, bits.join(" "))
            }
        }
        SerialPortType::BluetoothPort => format!("{} — Bluetooth", info.port_name),
        SerialPortType::PciPort => format!("{} — PCI", info.port_name),
        SerialPortType::Unknown => info.port_name.clone(),
    }
}

fn emit_status(app: &AppHandle, text: impl Into<String>) {
    let _ = app.emit(STATUS_EVENT, text.into());
}

fn flush_payload(app: &AppHandle, acc: &mut Vec<u8>) {
    if acc.is_empty() {
        return;
    }
    let text = String::from_utf8_lossy(acc).trim().to_string();
    acc.clear();
    if !text.is_empty() {
        let _ = app.emit(SCAN_EVENT, text);
    }
}

fn stop_inner(state: &ScannerState) {
    let flag = match state.stop.lock() {
        Ok(mut guard) => guard.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    };
    if let Some(flag) = flag {
        flag.store(true, Ordering::Relaxed);
        // The reader wakes on its 50ms timeout; wait one beat so the old
        // handle releases the port before a restart tries to open it.
        thread::sleep(Duration::from_millis(120));
    }
}

#[tauri::command]
pub fn list_scanner_ports() -> Result<Vec<ScannerPort>, String> {
    let ports = serialport::available_ports()
        .map_err(|e| format!("Could not list COM ports — {e}"))?;
    let mut out: Vec<ScannerPort> = ports
        .into_iter()
        .filter(|p| is_safe_port(&p.port_name))
        .map(|p| ScannerPort {
            label: usb_label(&p),
            name: p.port_name,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn start_scanner(
    app: AppHandle,
    state: State<ScannerState>,
    port: String,
    baud: u32,
) -> Result<(), String> {
    if !is_safe_port(&port) {
        return Err(format!("{port} is not a COM port this station can open."));
    }
    stop_inner(&state);

    let baud = if baud == 0 { 9600 } else { baud };
    let stop = Arc::new(AtomicBool::new(false));
    match state.stop.lock() {
        Ok(mut guard) => *guard = Some(stop.clone()),
        Err(poisoned) => *poisoned.into_inner() = Some(stop.clone()),
    }

    let path = windows_port_path(&port);
    let display = port.trim().to_string();
    thread::spawn(move || read_loop(app, path, display, baud, stop));
    Ok(())
}

#[tauri::command]
pub fn stop_scanner(state: State<ScannerState>) -> Result<(), String> {
    stop_inner(&state);
    Ok(())
}

fn open_port(path: &str, baud: u32) -> Result<Box<dyn serialport::SerialPort>, String> {
    serialport::new(path, baud)
        .timeout(READ_TIMEOUT)
        .open()
        .map_err(|e| format!("{e}"))
}

fn read_loop(app: AppHandle, path: String, display: String, baud: u32, stop: Arc<AtomicBool>) {
    let mut serial = match open_port(&path, baud) {
        Ok(p) => {
            emit_status(&app, format!("Listening on {display}"));
            p
        }
        Err(e) => {
            emit_status(&app, format!("Could not open {display} — {e}"));
            return;
        }
    };
    let _ = serial.write_data_terminal_ready(true);
    let _ = serial.write_request_to_send(true);

    let mut buf = [0u8; 256];
    let mut acc: Vec<u8> = Vec::new();
    let mut last_byte = Instant::now();

    while !stop.load(Ordering::Relaxed) {
        match serial.read(&mut buf) {
            Ok(0) => {
                if !acc.is_empty() && last_byte.elapsed() >= SILENCE_FLUSH {
                    flush_payload(&app, &mut acc);
                }
            }
            Ok(n) => {
                last_byte = Instant::now();
                for &b in &buf[..n] {
                    if b == b'\r' || b == b'\n' {
                        flush_payload(&app, &mut acc);
                    } else if b == 0x02 || b == 0x03 {
                        // STX/ETX some configs wrap around the decode.
                        if b == 0x03 {
                            flush_payload(&app, &mut acc);
                        }
                    } else if b.is_ascii_graphic() || b == b' ' {
                        acc.push(b);
                        if acc.len() > MAX_PAYLOAD {
                            acc.clear();
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                if !acc.is_empty() && last_byte.elapsed() >= SILENCE_FLUSH {
                    flush_payload(&app, &mut acc);
                }
            }
            Err(_) => {
                emit_status(&app, format!("{display} disconnected — waiting to reopen"));
                while !stop.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_millis(400));
                    match open_port(&path, baud) {
                        Ok(p) => {
                            serial = p;
                            let _ = serial.write_data_terminal_ready(true);
                            let _ = serial.write_request_to_send(true);
                            emit_status(&app, format!("Listening on {display}"));
                            acc.clear();
                            break;
                        }
                        Err(_) => {}
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_ordinary_com_names() {
        for name in ["COM1", "COM3", "COM10", r"\\.\COM12", "com4"] {
            assert!(is_safe_port(name), "should accept {name}");
        }
    }

    #[test]
    fn rejects_paths_that_are_not_com_ports() {
        for name in ["", "LPT1", "COM", "COM3A", r"C:\COM3", "../COM3", "COM3;notepad"] {
            assert!(!is_safe_port(name), "should reject {name}");
        }
    }

    #[test]
    fn high_com_numbers_get_the_windows_prefix() {
        assert_eq!(windows_port_path("COM10"), r"\\.\COM10");
        assert_eq!(windows_port_path("COM3"), "COM3");
        assert_eq!(windows_port_path(r"\\.\COM10"), r"\\.\COM10");
    }
}
