// SPDX-License-Identifier: GPL-2.0-or-later
// Keyboards behind a Keychron 2.4 GHz receiver: listed in place of the
// receiver's interface, opened by their `bridge:` serial number, and talked
// to with XOR-ed reports and the receiver's longer timing.

#![allow(clippy::unwrap_used)]

mod common;

use std::ffi::CString;
use std::sync::atomic::Ordering;

use common::{MockDevice, fixture, raw_device};
use pipette_hid::{
    BRIDGE_USAGE, BRIDGE_USAGE_PAGE, DeviceType, HID_USAGE, HID_USAGE_PAGE, MSG_LEN, RawDeviceInfo,
    VirtualDeviceMode, XOR_KEY,
};

const RECEIVER_VID: u16 = 0x3434;
const RECEIVER_PID: u16 = 0xd030;
const RECEIVER_PATH: &str = "/dev/hidraw7";
/// The keyboard paired with the receiver.
const KEYBOARD: (u16, u16) = (0x3434, 0x0b10);

fn interface(path: &str, usage_page: u16, usage: u16) -> MockDevice {
    MockDevice {
        info: RawDeviceInfo {
            path: CString::new(path).unwrap(),
            vendor_id: RECEIVER_VID,
            product_id: RECEIVER_PID,
            serial_number: None,
            product: Some("Keychron Link".into()),
        },
        usage_page,
        usage,
    }
}

/// The receiver's two interfaces: the one that marks it and its Vial one.
fn receiver() -> [MockDevice; 2] {
    [
        interface("/dev/hidraw6", BRIDGE_USAGE_PAGE, BRIDGE_USAGE),
        interface(RECEIVER_PATH, HID_USAGE_PAGE, HID_USAGE),
    ]
}

fn report(bytes: &[u8]) -> Vec<u8> {
    let mut report = vec![0u8; MSG_LEN];
    report[..bytes.len()].copy_from_slice(bytes);
    report
}

/// The receiver's answers to a handshake with the keyboard connected (or
/// paired but not connected).
fn handshake_answers(connected: bool) -> Vec<Result<Vec<u8>, String>> {
    let mut state = vec![0xB2, 3];
    state.extend(KEYBOARD.0.to_le_bytes());
    state.extend(KEYBOARD.1.to_le_bytes());
    state.push(u8::from(connected));
    vec![Ok(report(&[0xB1, 3, 0, 0])), Ok(report(&state)), Ok(report(&[0xB3, b'2', b'.', b'0', 0]))]
}

fn xored(report: &[u8]) -> Vec<u8> {
    report.iter().map(|b| b ^ XOR_KEY).collect()
}

#[test]
fn the_connected_keyboard_is_listed_in_place_of_the_receiver_before_the_virtual_keyboard() {
    let f = fixture(VirtualDeviceMode::Append);
    let mut devices = vec![raw_device("/dev/hidraw0")];
    devices.extend(receiver());
    *f.backend.devices.lock().unwrap() = devices;
    let handle = f.backend.handle_for(RECEIVER_PATH);
    handle.reads.lock().unwrap().extend(handshake_answers(true));

    let list = f.service.list_devices().unwrap();
    let names: Vec<&str> = list.iter().map(|d| d.product_name.as_str()).collect();
    assert_eq!(names, ["Real Test Keyboard", "Keychron (wireless via 2.0) [2.4 GHz]", "Virtual Keyboard"]);
    let wireless = &list[1];
    assert_eq!((wireless.vendor_id, wireless.product_id), KEYBOARD);
    assert_eq!(wireless.serial_number, format!("bridge:{RECEIVER_PATH}"));
    assert_eq!(wireless.device_type, DeviceType::Vial);
    // Opened for the handshake only.
    assert_eq!(handle.close_calls.load(Ordering::SeqCst), 1);
}

#[test]
fn a_receiver_without_a_connected_keyboard_lists_nothing() {
    let f = fixture(VirtualDeviceMode::Off);
    *f.backend.devices.lock().unwrap() = receiver().to_vec();
    f.backend.handle_for(RECEIVER_PATH).reads.lock().unwrap().extend(handshake_answers(false));
    assert!(f.service.list_devices().unwrap().is_empty());
}

#[test]
fn the_bridge_serial_opens_the_keyboard_and_reports_are_xored() {
    let f = fixture(VirtualDeviceMode::Off);
    *f.backend.devices.lock().unwrap() = receiver().to_vec();
    let handle = f.backend.handle_for(RECEIVER_PATH);
    handle.reads.lock().unwrap().extend(handshake_answers(true));

    let serial = format!("bridge:{RECEIVER_PATH}");
    assert!(f.service.open_device_with_serial(KEYBOARD.0, KEYBOARD.1, Some(&serial)).unwrap());

    handle.writes.lock().unwrap().clear();
    handle.read_timeouts.lock().unwrap().clear();
    handle.reads.lock().unwrap().push_back(Ok(xored(&report(&[0x01, 0x00, 0x0c]))));
    let answer = f.service.send_receive(&[0x01]).unwrap();
    assert_eq!(answer.to_vec(), report(&[0x01, 0x00, 0x0c]));

    let written = handle.writes.lock().unwrap()[0].clone();
    assert_eq!(written[0], 0);
    assert_eq!(&written[1..], xored(&report(&[0x01])).as_slice());
    // The receiver's read window.
    assert_eq!(*handle.read_timeouts.lock().unwrap(), [1000]);

    // While open, listing reports the keyboard without another handshake.
    let writes_before = handle.writes.lock().unwrap().len();
    let list = f.service.list_devices().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].serial_number, serial);
    assert_eq!(handle.writes.lock().unwrap().len(), writes_before);
}

#[test]
fn a_receiver_without_a_connected_keyboard_does_not_open() {
    let f = fixture(VirtualDeviceMode::Off);
    *f.backend.devices.lock().unwrap() = receiver().to_vec();
    let handle = f.backend.handle_for(RECEIVER_PATH);
    handle.reads.lock().unwrap().extend(handshake_answers(false));
    let serial = format!("bridge:{RECEIVER_PATH}");
    assert!(!f.service.open_device_with_serial(KEYBOARD.0, KEYBOARD.1, Some(&serial)).unwrap());
    assert_eq!(handle.close_calls.load(Ordering::SeqCst), 1);
    assert!(!f.service.is_device_open().unwrap());
}

#[test]
fn an_open_receiver_counts_as_gone_only_after_repeated_checks() {
    let f = fixture(VirtualDeviceMode::Off);
    *f.backend.devices.lock().unwrap() = receiver().to_vec();
    f.backend.handle_for(RECEIVER_PATH).reads.lock().unwrap().extend(handshake_answers(true));
    let serial = format!("bridge:{RECEIVER_PATH}");
    assert!(f.service.open_device_with_serial(KEYBOARD.0, KEYBOARD.1, Some(&serial)).unwrap());
    assert!(f.service.is_device_open().unwrap());

    f.backend.devices.lock().unwrap().clear();
    let sleeps_before = f.sleeps.load(Ordering::SeqCst);
    let enumerations_before = f.backend.enumerate_calls.load(Ordering::SeqCst);
    assert!(!f.service.is_device_open().unwrap());
    assert_eq!(f.backend.enumerate_calls.load(Ordering::SeqCst) - enumerations_before, 3);
    assert_eq!(f.sleeps.load(Ordering::SeqCst) - sleeps_before, 2);
}

#[test]
fn another_serial_number_opens_by_vid_and_pid() {
    let f = fixture(VirtualDeviceMode::Off);
    f.backend.devices.lock().unwrap().push(raw_device("/dev/hidraw0"));
    assert!(f.service.open_device_with_serial(0x1234, 0x5678, Some("vial:f64c2b3c")).unwrap());
    assert_eq!(*f.backend.opened_paths.lock().unwrap(), [CString::new("/dev/hidraw0").unwrap()]);
}
