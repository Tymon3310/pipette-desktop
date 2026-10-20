// SPDX-License-Identifier: GPL-2.0-or-later
//! Device enumeration, connection and serialized 32-byte packet I/O.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use pipette_protocol::{MSG_LEN, Report, pad_report};
use pipette_virtual_device::{VirtualDevice, VirtualDeviceController, VirtualDeviceMode};

use crate::backend::{HidBackend, HidHandle, RawDeviceInfo};
use crate::bridge::{
    BRIDGE_PRESENCE_CHECKS, BRIDGE_PRESENCE_DELAY_MS, BRIDGE_RETRY_COUNT, BRIDGE_RETRY_DELAY_MS,
    BRIDGE_TIMEOUT_MS, BridgeHandle, BridgeSession, RawBridgeInfo, bridge_path, bridge_product_name,
    bridge_serial, handshake,
};
use crate::constants::{
    HID_OPEN_RETRY_COUNT, HID_OPEN_RETRY_DELAY_MS, HID_REPORT_ID, HID_RETRY_COUNT, HID_RETRY_DELAY_MS,
    HID_TIMEOUT_MS,
};
use crate::device_info::{DeviceInfo, DeviceType};
use crate::error::HidError;
use crate::hidapi_backend::HidapiBackend;
use crate::packet_log::{Direction, log_packet, packet_logging_from_env};
use crate::probe::ProbeSlot;
use crate::timing::Timing;
use crate::virtual_backend::{DeviceBackends, VIRTUAL_DEVICE_PATH, VirtualBackend};
use pipette_fifo::FifoLock;

const READ_BUFFER_LEN: usize = 256;

type Packet = [u8; MSG_LEN + 1];

struct OpenDevice {
    handle: Arc<dyn HidHandle>,
    path: std::ffi::CString,
    /// The keyboard behind a Keychron 2.4 GHz receiver, when `path` is the
    /// receiver's (see `bridge.rs`).
    bridge: Option<BridgeSession>,
}

/// How an exchange waits and retries: over USB, or through a receiver.
#[derive(Clone, Copy)]
struct IoProfile {
    timeout_ms: i32,
    retries: u32,
    retry_delay_ms: u64,
}

const USB_IO: IoProfile =
    IoProfile { timeout_ms: HID_TIMEOUT_MS, retries: HID_RETRY_COUNT, retry_delay_ms: HID_RETRY_DELAY_MS };

const BRIDGE_IO: IoProfile = IoProfile {
    timeout_ms: BRIDGE_TIMEOUT_MS,
    retries: BRIDGE_RETRY_COUNT,
    retry_delay_ms: BRIDGE_RETRY_DELAY_MS,
};

/// One per process. Every method takes `&self` and blocks; call it from a
/// worker thread, not an async executor.
pub struct HidService {
    backend: DeviceBackends,
    controller: VirtualDeviceController,
    timing: Timing,
    /// The one open device, real or virtual.
    open_device: Mutex<Option<OpenDevice>>,
    /// Serializes send/send_receive in arrival order.
    io_queue: FifoLock,
    /// Whether every report sent and received is logged (`VIAL_DEBUG_HID`).
    log_packets: bool,
    /// The temporary handle of a probe, next to the main connection.
    probe: ProbeSlot,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A read that is exactly one report long plus a leading report ID 0 has the
/// ID stripped (some platforms include it); anything else is zero-padded or
/// truncated to MSG_LEN.
fn normalize_response(buf: &[u8]) -> Report {
    if buf.len() == MSG_LEN + 1 && buf[0] == HID_REPORT_ID {
        return pad_report(&buf[1..]);
    }
    pad_report(buf)
}

/// Logs why a device could not be opened, so the cause is not lost behind
/// the message the renderer shows.
fn log_open_failure(vendor_id: u16, product_id: u16, err: &HidError) {
    log::error!("Failed to open HID device 0x{vendor_id:04x}:0x{product_id:04x}: {err}");
}

/// Writes `packet` and reads the response once, waiting HID_TIMEOUT_MS.
/// `None` is an empty read (the timeout passed), kept apart from every error
/// the handle returns: only an empty read is ever retried. Every exchange,
/// the main connection's and the probe's, goes through here.
fn write_and_read_once(handle: &dyn HidHandle, packet: &Packet) -> Result<Option<Report>, HidError> {
    write_and_read_once_within(handle, packet, HID_TIMEOUT_MS)
}

/// [`write_and_read_once`], waiting `timeout_ms` for the response.
fn write_and_read_once_within(
    handle: &dyn HidHandle,
    packet: &Packet,
    timeout_ms: i32,
) -> Result<Option<Report>, HidError> {
    handle.write(packet)?;
    // Larger than any report, so the length read is the report's own length
    // and normalize_response sees what the device sent.
    let mut buf = [0u8; READ_BUFFER_LEN];
    match handle.read_timeout(&mut buf, timeout_ms)? {
        0 => Ok(None),
        read => Ok(Some(normalize_response(&buf[..read]))),
    }
}

/// Report ID 0 followed by the zero-padded 32-byte report.
fn packet(data: &[u8]) -> Packet {
    let mut packet = [0u8; MSG_LEN + 1];
    packet[0] = HID_REPORT_ID;
    packet[1..].copy_from_slice(&pad_report(data));
    packet
}

impl HidService {
    /// Real hardware through hidapi, with the virtual keyboard per `mode`
    /// (resolve it once at startup, e.g. with [`VirtualDeviceMode::from_env`]).
    pub fn new(mode: VirtualDeviceMode) -> Self {
        Self::build(Box::new(HidapiBackend::new()), mode, Timing::system())
    }

    /// `hardware` in place of hidapi and `timing` in place of the system
    /// clock and real retry delays.
    #[cfg(any(test, feature = "test-util"))]
    pub fn with_backend(hardware: Box<dyn HidBackend>, mode: VirtualDeviceMode, timing: Timing) -> Self {
        Self::build(hardware, mode, timing)
    }

    fn build(hardware: Box<dyn HidBackend>, mode: VirtualDeviceMode, timing: Timing) -> Self {
        let device = Arc::new(Mutex::new(VirtualDevice::new()));
        let controller = VirtualDeviceController::new(Arc::clone(&device));
        let virtual_device = VirtualBackend::new(device, timing.clone());
        Self {
            backend: DeviceBackends::new(hardware, virtual_device, mode),
            controller,
            timing,
            open_device: Mutex::new(None),
            io_queue: FifoLock::default(),
            log_packets: packet_logging_from_env(),
            probe: ProbeSlot::default(),
        }
    }

    /// Turns the packet logs on or off, whatever `VIAL_DEBUG_HID` says.
    #[cfg(any(test, feature = "test-util"))]
    pub fn with_packet_logging(mut self, enabled: bool) -> Self {
        self.log_packets = enabled;
        self
    }

    /// The controller of the virtual keyboard (key presses, unlock counter,
    /// reset), for tests and development tools.
    pub fn virtual_device(&self) -> VirtualDeviceController {
        self.controller.clone()
    }

    /// Vial interfaces (usage page 0xFF60, usage 0x61). In `Only` mode just
    /// the virtual device, without enumerating hardware; in `Append` mode the
    /// virtual device is appended after the real ones.
    ///
    /// A Keychron 2.4 GHz receiver's own interface is left out; in its place
    /// comes the keyboard connected to it, if any, with the serial number
    /// `bridge:<path>` (see `bridge.rs`), before the virtual keyboard.
    pub fn list_devices(&self) -> Result<Vec<DeviceInfo>, HidError> {
        let mut raw = self.backend.enumerate()?;
        let bridges = self.backend.bridges().unwrap_or_else(|err| {
            log::warn!("Listing Keychron receivers failed: {err}");
            Vec::new()
        });
        if bridges.is_empty() {
            return Ok(raw.into_iter().map(DeviceInfo::from).collect());
        }
        raw.retain(|d| !bridges.iter().any(|b| b.via_path == d.path));
        let wireless: Vec<DeviceInfo> =
            bridges.iter().filter_map(|bridge| self.bridge_device_info(bridge, &raw)).collect();
        let virtual_at =
            raw.iter().position(|d| d.path.as_c_str() == VIRTUAL_DEVICE_PATH).unwrap_or(raw.len());
        let mut devices: Vec<DeviceInfo> = raw.into_iter().map(DeviceInfo::from).collect();
        devices.splice(virtual_at..virtual_at, wireless);
        Ok(devices)
    }

    /// The keyboard connected to `bridge`, if any: from the open connection
    /// when it is this receiver, otherwise from a handshake on a handle
    /// opened for it and closed again. `listed` names the keyboard when it
    /// is also plugged in.
    fn bridge_device_info(&self, bridge: &RawBridgeInfo, listed: &[RawDeviceInfo]) -> Option<DeviceInfo> {
        let open_session = lock(&self.open_device)
            .as_ref()
            .filter(|d| d.path == bridge.via_path)
            .and_then(|d| d.bridge.clone());
        let session = match open_session {
            Some(session) => session,
            None => {
                let handle = match self.backend.hardware().open_path(&bridge.via_path) {
                    Ok(handle) => handle,
                    Err(err) => {
                        log::warn!("Opening the Keychron receiver {:?} failed: {err}", bridge.via_path);
                        return None;
                    }
                };
                let result = handshake(handle.as_ref(), self.timing.sleep.as_ref());
                handle.close();
                match result {
                    Ok(session) => session?,
                    Err(err) => {
                        log::warn!("The Keychron receiver {:?} did not answer: {err}", bridge.via_path);
                        return None;
                    }
                }
            }
        };
        let own_name = listed
            .iter()
            .find(|d| d.vendor_id == session.vendor_id && d.product_id == session.product_id)
            .and_then(|d| d.product.as_deref());
        Some(DeviceInfo {
            vendor_id: session.vendor_id,
            product_id: session.product_id,
            product_name: bridge_product_name(own_name, &session.firmware_version),
            serial_number: bridge_serial(&bridge.via_path),
            device_type: DeviceType::Vial,
        })
    }

    /// Close whatever is open, then open the keyboard behind the Keychron
    /// receiver at `path` (from a `bridge:` serial number). `Ok(false)` when
    /// no keyboard is connected to it.
    fn open_bridge(&self, path: std::ffi::CString) -> Result<bool, HidError> {
        self.close_device();
        let handle = self.backend.hardware().open_path(&path).inspect_err(|err| {
            log::error!("Failed to open the Keychron receiver {path:?}: {err}");
        })?;
        let session = match handshake(handle.as_ref(), self.timing.sleep.as_ref()) {
            Ok(Some(session)) => session,
            Ok(None) => {
                handle.close();
                return Ok(false);
            }
            Err(err) => {
                handle.close();
                log::error!("The Keychron receiver {path:?} did not answer: {err}");
                return Err(err);
            }
        };
        let mut open_device = lock(&self.open_device);
        self.probe.close_path(&path);
        *open_device =
            Some(OpenDevice { handle: Arc::new(BridgeHandle::new(handle)), path, bridge: Some(session) });
        Ok(true)
    }

    /// Close whatever is open, then open the first Vial interface matching
    /// `vendor_id`/`product_id`. Returns `Ok(false)` when none is present.
    /// Opening is retried (transient failures happen on every platform);
    /// the last error is returned. A failed enumeration and the last failed
    /// attempt are logged.
    pub fn open_device(&self, vendor_id: u16, product_id: u16) -> Result<bool, HidError> {
        self.open_device_with_serial(vendor_id, product_id, None)
    }

    /// [`HidService::open_device`], except that a `serial_number` from the
    /// device list naming a Keychron 2.4 GHz receiver (`bridge:<path>`)
    /// opens the keyboard behind that receiver; any other serial number is
    /// ignored.
    pub fn open_device_with_serial(
        &self,
        vendor_id: u16,
        product_id: u16,
        serial_number: Option<&str>,
    ) -> Result<bool, HidError> {
        if let Some(path) = serial_number.and_then(bridge_path) {
            return self.open_bridge(path);
        }
        self.close_device();

        let found = self.backend.find(vendor_id, product_id).inspect_err(|err| {
            log_open_failure(vendor_id, product_id, err);
        })?;
        let Some(RawDeviceInfo { path, .. }) = found else {
            return Ok(false);
        };

        let mut attempt = 0;
        loop {
            match self.backend.open_path(&path) {
                Ok(handle) => {
                    let mut open_device = lock(&self.open_device);
                    // A probe that opened this interface while it was not yet
                    // the main connection would share the device with it.
                    self.probe.close_path(&path);
                    *open_device = Some(OpenDevice { handle, path, bridge: None });
                    return Ok(true);
                }
                Err(err) => {
                    attempt += 1;
                    if attempt >= HID_OPEN_RETRY_COUNT {
                        log_open_failure(vendor_id, product_id, &err);
                        return Err(err);
                    }
                    (self.timing.sleep)(Duration::from_millis(HID_OPEN_RETRY_DELAY_MS));
                }
            }
        }
    }

    pub fn close_device(&self) {
        if let Some(device) = lock(&self.open_device).take() {
            device.handle.close();
        }
    }

    /// Send one report (zero-padded to 32 bytes) and wait for the response.
    /// Requests are served one at a time in arrival order. A read that times
    /// out is retried (write included) up to HID_RETRY_COUNT times; any other
    /// error fails at once.
    ///
    /// Through a Keychron receiver the read window is longer and there are
    /// more attempts (`bridge.rs`).
    pub fn send_receive(&self, data: &[u8]) -> Result<Report, HidError> {
        self.exchange(data, |handle, packet, io| {
            for attempt in 0..io.retries {
                if let Some(report) = write_and_read_once_within(handle, packet, io.timeout_ms)? {
                    log_packet(self.log_packets, Direction::Rx, &report);
                    return Ok(report);
                }
                if attempt + 1 < io.retries {
                    (self.timing.sleep)(Duration::from_millis(io.retry_delay_ms));
                }
            }
            Err(HidError::ReadTimeout)
        })
    }

    /// Send one report without waiting for a response, in the same queue as
    /// [`HidService::send_receive`].
    pub fn send(&self, data: &[u8]) -> Result<(), HidError> {
        self.exchange(data, |handle, packet, _| handle.write(packet).map(drop))
    }

    /// True while a device is open and still enumerated. A device that has
    /// disappeared is closed.
    ///
    /// A Keychron receiver is looked for a few times before it counts as
    /// gone, so a wireless hiccup does not end the connection.
    pub fn is_device_open(&self) -> Result<bool, HidError> {
        let Some((path, bridged)) =
            lock(&self.open_device).as_ref().map(|d| (d.path.clone(), d.bridge.is_some()))
        else {
            return Ok(false);
        };
        let checks = if bridged { BRIDGE_PRESENCE_CHECKS } else { 1 };
        let mut present = false;
        for check in 0..checks {
            if check > 0 {
                (self.timing.sleep)(Duration::from_millis(BRIDGE_PRESENCE_DELAY_MS));
            }
            present = self.backend.is_present(&path)?;
            if present {
                break;
            }
        }
        if !present {
            self.close_device();
        }
        Ok(present)
    }

    /// Opens the first Vial interface on real hardware with this VID/PID that
    /// is not the main connection — and, when `serial_number` is given and
    /// not empty, whose serial number is exactly that — as the probe handle,
    /// closing any probe handle open before. Returns the new handle's id.
    /// The virtual keyboard is never a candidate, and hardware is searched
    /// even when the device list shows only the virtual keyboard. One
    /// attempt, nothing logged.
    ///
    /// The main connection's state stays locked from reading its path until
    /// the probe handle is in place; together with [`HidService::open_device`]
    /// closing a probe on the interface it opens, the probe and the main
    /// connection never hold the same interface.
    ///
    /// A [`HidService::close_probe`] while this runs (the page that asked
    /// for the probe is going away) wins: the new handle is closed at once
    /// and the open fails with [`HidError::ProbeNotOpen`].
    pub fn probe_open(
        &self,
        vendor_id: u16,
        product_id: u16,
        serial_number: Option<&str>,
    ) -> Result<u32, HidError> {
        let epoch = self.probe.epoch();
        self.probe.close(None);
        let serial_number = serial_number.filter(|s| !s.is_empty());
        let open_device = lock(&self.open_device);
        let main_path = open_device.as_ref().map(|d| &d.path);
        let hardware = self.backend.hardware();
        let target = hardware
            .enumerate()?
            .into_iter()
            .find(|d| {
                d.vendor_id == vendor_id
                    && d.product_id == product_id
                    && main_path != Some(&d.path)
                    && serial_number.is_none_or(|s| d.serial_number.as_deref().unwrap_or_default() == s)
            })
            .ok_or(HidError::ProbeTargetNotFound)?;
        let handle = hardware.open_path(&target.path)?;
        self.probe.replace(handle, target.path, epoch).ok_or(HidError::ProbeNotOpen)
    }

    /// Sends one report (zero-padded to 32 bytes) over the probe handle `id`
    /// and reads the response once, waiting HID_TIMEOUT_MS; an empty read is
    /// [`HidError::ProbeReadTimeout`].
    /// No retries and no packet logs; probe requests do not queue behind the
    /// main connection's.
    pub fn probe_send_receive(&self, id: u32, data: &[u8]) -> Result<Report, HidError> {
        if data.len() > MSG_LEN {
            return Err(HidError::DataTooLong { max: MSG_LEN });
        }
        let handle = self.probe.handle(id).ok_or(HidError::ProbeNotOpen)?;
        write_and_read_once(handle.as_ref(), &packet(data))?.ok_or(HidError::ProbeReadTimeout)
    }

    /// Closes the probe handle `id`; nothing when it is no longer the open one.
    pub fn probe_close(&self, id: u32) {
        self.probe.close(Some(id));
    }

    /// Closes the probe handle, whichever is open, and makes every probe
    /// being opened now fail (when the page loads again, and at quit).
    pub fn close_probe(&self) {
        self.probe.supersede();
    }

    /// Length check, then `io` on the open device's handle with the framed
    /// packet, inside the I/O queue, logging the report as sent. The handle
    /// is pinned for the whole exchange, retries included: open and close
    /// replace it outside the queue.
    fn exchange<R>(
        &self,
        data: &[u8],
        io: impl FnOnce(&dyn HidHandle, &Packet, IoProfile) -> Result<R, HidError>,
    ) -> Result<R, HidError> {
        if data.len() > MSG_LEN {
            return Err(HidError::DataTooLong { max: MSG_LEN });
        }
        let _turn = self.io_queue.acquire();
        let (handle, profile) = lock(&self.open_device)
            .as_ref()
            .map(|d| (Arc::clone(&d.handle), if d.bridge.is_some() { BRIDGE_IO } else { USB_IO }))
            .ok_or(HidError::NotOpen)?;
        let packet = packet(data);
        // Once per request, retries included, without the report ID.
        log_packet(self.log_packets, Direction::Tx, &packet[1..]);
        io(handle.as_ref(), &packet, profile)
    }
}
