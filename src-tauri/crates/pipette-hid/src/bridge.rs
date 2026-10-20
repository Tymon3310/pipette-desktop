// SPDX-License-Identifier: GPL-2.0-or-later
//! Keychron 2.4 GHz receivers (Keychron Link / Forza Receiver).
//!
//! A receiver is told apart by an interface on usage page 0x8C; the traffic
//! goes through the receiver's own Vial raw-HID interface (0xFF60/0x61) on
//! the same USB device. The receiver answers its own `FR_*` commands in
//! plain bytes, and tunnels every other report to the keyboard paired with
//! it with each byte XOR-ed with [`XOR_KEY`] (the wireless module of the
//! keyboard crashes on some byte values, 0xFE among them). The receiver may
//! also send an unrequested state report (0xBC / 0xE2) in place of an answer.
//!
//! The device list shows the keyboard behind a receiver with the keyboard's
//! VID/PID and the serial number `bridge:<path of the receiver's interface>`
//! ([`bridge_serial`]); opening that serial opens the receiver through
//! [`BridgeHandle`]. Ported from vial-gui `protocol/bridge.py`.

use std::ffi::CString;
use std::sync::Arc;
use std::time::Duration;

use pipette_protocol::{MSG_LEN, Report, pad_report};

use crate::backend::HidHandle;
use crate::constants::HID_REPORT_ID;
use crate::error::HidError;

/// The interface that marks a receiver.
pub const BRIDGE_USAGE_PAGE: u16 = 0x8C;
pub const BRIDGE_USAGE: u16 = 0x01;

/// The serial number prefix of a keyboard behind a receiver.
pub const BRIDGE_SERIAL_PREFIX: &str = "bridge:";

/// Suffix of the product name of a keyboard behind a receiver.
const BRIDGE_NAME_SUFFIX: &str = " [2.4 GHz]";

const FR_GET_PROTOCOL_VERSION: u8 = 0xB1;
const FR_GET_STATE: u8 = 0xB2;
const FR_GET_FW_VERSION: u8 = 0xB3;
const FR_CTL_GAMEPAD_RPT_ENABLE: u8 = 0xB5;
const FR_STATE_NOTIFY: u8 = 0xBC;
const FR_STATE_NOTIFY_ALT: u8 = 0xE2;

/// Feature flag (byte 3 of the protocol version answer): the receiver can
/// stop sending gamepad reports while VIA is in use.
const FEAT_VIA_DISABLE_GAMEPAD_INPUT: u8 = 0x10;

/// The receiver reports up to three paired keyboards.
const SLOT_COUNT: usize = 3;

/// Every tunnelled byte is XOR-ed with this.
pub const XOR_KEY: u8 = 0x28;

/// Read window, attempts and delay between attempts of an exchange through
/// a receiver: more lenient than over USB, to ride out wireless latency.
pub(crate) const BRIDGE_TIMEOUT_MS: i32 = 1000;
pub(crate) const BRIDGE_RETRY_COUNT: u32 = 8;
pub(crate) const BRIDGE_RETRY_DELAY_MS: u64 = 150;

/// Presence checks of an open receiver: attempts and the delay between them,
/// so a wireless hiccup is not taken for a disconnect.
pub(crate) const BRIDGE_PRESENCE_CHECKS: u32 = 3;
pub(crate) const BRIDGE_PRESENCE_DELAY_MS: u64 = 500;

/// One HID interface as enumerated, with its usage, for finding receivers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HidInterface {
    pub path: CString,
    pub vendor_id: u16,
    pub product_id: u16,
    pub usage_page: u16,
    pub usage: u16,
}

/// A receiver: the path of its Vial raw-HID interface, which carries the
/// traffic.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawBridgeInfo {
    pub via_path: CString,
    pub vendor_id: u16,
    pub product_id: u16,
}

/// The receivers among `interfaces`: each 0x8C interface with a Vial
/// interface of the same VID/PID at another path.
pub fn find_bridges(interfaces: &[HidInterface]) -> Vec<RawBridgeInfo> {
    let mut bridges: Vec<RawBridgeInfo> = Vec::new();
    for detect in interfaces.iter().filter(|i| i.usage_page == BRIDGE_USAGE_PAGE && i.usage == BRIDGE_USAGE) {
        let via = interfaces.iter().find(|i| {
            i.vendor_id == detect.vendor_id
                && i.product_id == detect.product_id
                && crate::hidapi_backend::is_vial_interface(i.usage_page, i.usage)
                && i.path != detect.path
        });
        if let Some(via) = via
            && !bridges.iter().any(|b| b.via_path == via.path)
        {
            bridges.push(RawBridgeInfo {
                via_path: via.path.clone(),
                vendor_id: detect.vendor_id,
                product_id: detect.product_id,
            });
        }
    }
    bridges
}

/// The serial number the device list gives the keyboard behind the receiver
/// at `via_path`.
pub fn bridge_serial(via_path: &CString) -> String {
    format!("{BRIDGE_SERIAL_PREFIX}{}", via_path.to_string_lossy())
}

/// The receiver path in a serial number from [`bridge_serial`], if it is one.
pub fn bridge_path(serial_number: &str) -> Option<CString> {
    let path = serial_number.strip_prefix(BRIDGE_SERIAL_PREFIX)?;
    if path.is_empty() {
        return None;
    }
    CString::new(path).ok()
}

/// The device list name of the keyboard behind a receiver: its own product
/// name when it is also enumerated (plugged in by cable), otherwise a
/// generic one.
pub fn bridge_product_name(own_name: Option<&str>, firmware_version: &str) -> String {
    let base = match own_name.filter(|name| !name.is_empty()) {
        Some(name) => name.to_owned(),
        None if firmware_version.is_empty() => "Keychron (wireless)".to_owned(),
        None => format!("Keychron (wireless via {firmware_version})"),
    };
    format!("{base}{BRIDGE_NAME_SUFFIX}")
}

/// The keyboard connected to a receiver, as its handshake reported it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BridgeSession {
    pub vendor_id: u16,
    pub product_id: u16,
    pub firmware_version: String,
}

fn is_state_notify(byte: u8) -> bool {
    byte == FR_STATE_NOTIFY || byte == FR_STATE_NOTIFY_ALT
}

/// Where the report starts in a read of `len` bytes: past a leading report
/// ID 0 when the read is one byte longer than a report.
fn report_offset(buf: &[u8], len: usize) -> usize {
    usize::from(len == MSG_LEN + 1 && buf.first() == Some(&HID_REPORT_ID))
}

/// Report ID 0, then `data` zero-padded to a report.
fn packet(data: &[u8]) -> [u8; MSG_LEN + 1] {
    let mut packet = [0u8; MSG_LEN + 1];
    packet[0] = HID_REPORT_ID;
    packet[1..].copy_from_slice(&pad_report(data));
    packet
}

/// Reads one answer of the receiver, skipping one unrequested state report.
/// Returns the raw bytes read (0 when the read window passed).
fn read_skipping_notify(inner: &dyn HidHandle, buf: &mut [u8], timeout_ms: i32) -> Result<usize, HidError> {
    let mut read = inner.read_timeout(buf, timeout_ms)?;
    if read > 0 && buf.get(report_offset(buf, read)).copied().is_some_and(is_state_notify) {
        read = inner.read_timeout(buf, timeout_ms)?;
    }
    Ok(read)
}

/// Sends one plain `FR_*` command to the receiver and returns its answer.
/// Every failure and empty read is retried, `BRIDGE_RETRY_COUNT` attempts in
/// all, `sleep` waiting between them.
fn send_raw(inner: &dyn HidHandle, msg: &[u8], sleep: &dyn Fn(Duration)) -> Result<Report, HidError> {
    let packet = packet(msg);
    let mut buf = [0u8; 256];
    let mut last_error = HidError::ReadTimeout;
    for attempt in 0..BRIDGE_RETRY_COUNT {
        if attempt > 0 {
            sleep(Duration::from_millis(BRIDGE_RETRY_DELAY_MS));
        }
        if let Err(err) = inner.write(&packet) {
            last_error = err;
            continue;
        }
        match read_skipping_notify(inner, &mut buf, BRIDGE_TIMEOUT_MS) {
            Ok(0) => last_error = HidError::ReadTimeout,
            Ok(read) => return Ok(pad_report(&buf[report_offset(&buf, read)..read])),
            Err(err) => last_error = err,
        }
    }
    Err(last_error)
}

/// The receiver's handshake: protocol version and features, the paired
/// keyboards and the firmware version; turns gamepad reports off when the
/// receiver supports it. `None` when no paired keyboard is connected.
pub(crate) fn handshake(
    inner: &dyn HidHandle,
    sleep: &dyn Fn(Duration),
) -> Result<Option<BridgeSession>, HidError> {
    let version = send_raw(inner, &[FR_GET_PROTOCOL_VERSION], sleep)?;
    let features = if version[0] == FR_GET_PROTOCOL_VERSION { version[3] } else { 0 };

    let state = send_raw(inner, &[FR_GET_STATE], sleep)?;
    let mut connected = None;
    if state[0] == FR_GET_STATE {
        for slot in 0..SLOT_COUNT {
            let base = 2 + slot * 5;
            let vendor_id = u16::from_le_bytes([state[base], state[base + 1]]);
            let product_id = u16::from_le_bytes([state[base + 2], state[base + 3]]);
            if state[base + 4] != 0 && (vendor_id != 0 || product_id != 0) {
                connected = Some((vendor_id, product_id));
                break;
            }
        }
    }

    // The firmware version only names the device; a receiver that does not
    // answer still works.
    let firmware_version = match send_raw(inner, &[FR_GET_FW_VERSION], sleep) {
        Ok(answer) if answer[0] == FR_GET_FW_VERSION => {
            let text = &answer[1..];
            let end = text.iter().position(|&b| b == 0).unwrap_or(text.len());
            String::from_utf8_lossy(&text[..end]).into_owned()
        }
        _ => String::new(),
    };

    if features & FEAT_VIA_DISABLE_GAMEPAD_INPUT != 0
        && let Err(err) = send_raw(inner, &[FR_CTL_GAMEPAD_RPT_ENABLE, 0], sleep)
    {
        log::warn!("Keychron receiver: turning gamepad reports off failed: {err}");
    }

    Ok(connected.map(|(vendor_id, product_id)| BridgeSession { vendor_id, product_id, firmware_version }))
}

/// The receiver's interface as the handle of the keyboard behind it: every
/// report byte written and read is XOR-ed with [`XOR_KEY`], and an
/// unrequested state report in place of an answer is skipped.
pub(crate) struct BridgeHandle {
    inner: Arc<dyn HidHandle>,
}

impl BridgeHandle {
    pub(crate) fn new(inner: Arc<dyn HidHandle>) -> Self {
        Self { inner }
    }
}

impl HidHandle for BridgeHandle {
    /// `data` is a packet: report ID (not encoded), then the report.
    fn write(&self, data: &[u8]) -> Result<usize, HidError> {
        let mut encoded = data.to_vec();
        for byte in encoded.iter_mut().skip(1) {
            *byte ^= XOR_KEY;
        }
        self.inner.write(&encoded)
    }

    fn read_timeout(&self, buf: &mut [u8], timeout_ms: i32) -> Result<usize, HidError> {
        let read = read_skipping_notify(self.inner.as_ref(), buf, timeout_ms)?;
        let offset = report_offset(buf, read);
        for byte in &mut buf[offset..read] {
            *byte ^= XOR_KEY;
        }
        Ok(read)
    }

    fn close(&self) {
        self.inner.close();
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::*;

    fn iface(path: &str, vid: u16, pid: u16, usage_page: u16, usage: u16) -> HidInterface {
        HidInterface { path: CString::new(path).unwrap(), vendor_id: vid, product_id: pid, usage_page, usage }
    }

    #[test]
    fn a_receiver_is_its_0x8c_interface_with_a_vial_sibling() {
        let interfaces = [
            iface("/dev/hidraw1", 0x3434, 0xd030, 0x0001, 0x06),
            iface("/dev/hidraw2", 0x3434, 0xd030, 0x008c, 0x01),
            iface("/dev/hidraw3", 0x3434, 0xd030, 0xff60, 0x61),
            // A wired keyboard: not a receiver.
            iface("/dev/hidraw4", 0x3434, 0x0123, 0xff60, 0x61),
            // A 0x8C interface with no Vial sibling.
            iface("/dev/hidraw5", 0x3434, 0xd031, 0x008c, 0x01),
        ];
        assert_eq!(
            find_bridges(&interfaces),
            vec![RawBridgeInfo {
                via_path: CString::new("/dev/hidraw3").unwrap(),
                vendor_id: 0x3434,
                product_id: 0xd030,
            }]
        );
    }

    #[test]
    fn the_serial_number_round_trips_the_path() {
        let path = CString::new(r"\\?\hid#vid_3434&pid_d030&mi_01#7&1&0000#{4d1e55b2}").unwrap();
        let serial = bridge_serial(&path);
        assert!(serial.starts_with("bridge:"));
        assert_eq!(bridge_path(&serial), Some(path));
        assert_eq!(bridge_path("vial:f64c2b3c"), None);
        assert_eq!(bridge_path("bridge:"), None);
    }

    #[test]
    fn the_product_name_marks_the_connection() {
        assert_eq!(bridge_product_name(Some("Keychron Q1 HE"), "1.0"), "Keychron Q1 HE [2.4 GHz]");
        assert_eq!(bridge_product_name(None, "1.0.3"), "Keychron (wireless via 1.0.3) [2.4 GHz]");
        assert_eq!(bridge_product_name(Some(""), ""), "Keychron (wireless) [2.4 GHz]");
    }

    /// Records the packets written and answers reads from a script; `None`
    /// is an empty read.
    #[derive(Default)]
    struct Scripted {
        written: Mutex<Vec<Vec<u8>>>,
        reads: Mutex<VecDeque<Option<Vec<u8>>>>,
    }

    impl Scripted {
        fn with_reads(reads: Vec<Option<Vec<u8>>>) -> Arc<Self> {
            Arc::new(Self { written: Mutex::default(), reads: Mutex::new(reads.into()) })
        }
    }

    impl HidHandle for Scripted {
        fn write(&self, data: &[u8]) -> Result<usize, HidError> {
            self.written.lock().unwrap().push(data.to_vec());
            Ok(data.len())
        }

        fn read_timeout(&self, buf: &mut [u8], _timeout_ms: i32) -> Result<usize, HidError> {
            match self.reads.lock().unwrap().pop_front().flatten() {
                Some(bytes) => {
                    buf[..bytes.len()].copy_from_slice(&bytes);
                    Ok(bytes.len())
                }
                None => Ok(0),
            }
        }
    }

    fn report(bytes: &[u8]) -> Vec<u8> {
        pad_report(bytes).to_vec()
    }

    #[test]
    fn the_handshake_finds_the_connected_keyboard_and_turns_gamepad_reports_off() {
        let mut state = vec![FR_GET_STATE, 3];
        state.extend([0, 0, 0, 0, 0]); // empty slot
        state.extend([0x34, 0x34, 0x10, 0x0b, 1]); // 3434:0b10, connected
        let device = Scripted::with_reads(vec![
            Some(report(&[FR_GET_PROTOCOL_VERSION, 3, 0, 0x90])),
            // An unrequested state report before the answer is skipped.
            Some(report(&[FR_STATE_NOTIFY, 1, 0])),
            Some(report(&state)),
            Some(report(&[FR_GET_FW_VERSION, b'1', b'.', b'2', 0])),
            Some(report(&[FR_CTL_GAMEPAD_RPT_ENABLE])),
        ]);
        let session = handshake(device.as_ref(), &|_| {}).unwrap();
        assert_eq!(
            session,
            Some(BridgeSession { vendor_id: 0x3434, product_id: 0x0b10, firmware_version: "1.2".into() })
        );
        let written = device.written.lock().unwrap();
        let commands: Vec<u8> = written.iter().map(|p| p[1]).collect();
        assert_eq!(
            commands,
            [FR_GET_PROTOCOL_VERSION, FR_GET_STATE, FR_GET_FW_VERSION, FR_CTL_GAMEPAD_RPT_ENABLE]
        );
        assert!(written.iter().all(|p| p.len() == MSG_LEN + 1 && p[0] == HID_REPORT_ID));
    }

    #[test]
    fn no_connected_keyboard_is_none() {
        let mut state = vec![FR_GET_STATE, 3];
        state.extend([0x34, 0x34, 0x10, 0x0b, 0]); // paired, not connected
        let device = Scripted::with_reads(vec![
            Some(report(&[FR_GET_PROTOCOL_VERSION, 3, 0, 0])),
            Some(report(&state)),
            Some(report(&[FR_GET_FW_VERSION, 0])),
        ]);
        assert_eq!(handshake(device.as_ref(), &|_| {}).unwrap(), None);
    }

    #[test]
    fn a_silent_receiver_fails_after_the_retries() {
        let device = Scripted::with_reads(vec![]);
        let slept = std::cell::Cell::new(0);
        let err = handshake(device.as_ref(), &|_| slept.set(slept.get() + 1)).unwrap_err();
        assert!(matches!(err, HidError::ReadTimeout));
        assert_eq!(device.written.lock().unwrap().len(), BRIDGE_RETRY_COUNT as usize);
        assert_eq!(slept.get(), BRIDGE_RETRY_COUNT - 1);
    }

    #[test]
    fn the_handle_xors_reports_but_not_the_report_id() {
        let answer: Vec<u8> = report(&[0x01, 0x00, 0x09]).iter().map(|b| b ^ XOR_KEY).collect();
        let inner = Scripted::with_reads(vec![Some(report(&[FR_STATE_NOTIFY_ALT])), Some(answer)]);
        let handle = BridgeHandle::new(inner.clone());
        handle.write(&packet(&[0x01])).unwrap();
        let written = inner.written.lock().unwrap()[0].clone();
        assert_eq!(written[0], HID_REPORT_ID);
        assert_eq!(written[1], 0x01 ^ XOR_KEY);
        assert!(written[2..].iter().all(|&b| b == XOR_KEY));

        let mut buf = [0u8; 64];
        let read = handle.read_timeout(&mut buf, 10).unwrap();
        assert_eq!(&buf[..read], report(&[0x01, 0x00, 0x09]).as_slice());
    }

    #[test]
    fn the_handle_keeps_a_leading_report_id_of_a_read() {
        let mut answer = vec![HID_REPORT_ID];
        answer.extend(report(&[0x02]).iter().map(|b| b ^ XOR_KEY));
        let handle = BridgeHandle::new(Scripted::with_reads(vec![Some(answer)]));
        let mut buf = [0u8; 64];
        let read = handle.read_timeout(&mut buf, 10).unwrap();
        assert_eq!(read, MSG_LEN + 1);
        assert_eq!(buf[0], HID_REPORT_ID);
        assert_eq!(buf[1], 0x02);
        assert!(buf[2..read].iter().all(|&b| b == 0));
    }
}
