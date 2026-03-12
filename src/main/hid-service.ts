// SPDX-License-Identifier: GPL-2.0-or-later
// node-hid based HID transport — runs in main process.
// Handles raw HID device enumeration, connection, and 32-byte packet I/O.

import HID from 'node-hid'
import {
  MSG_LEN,
  HID_USAGE_PAGE,
  HID_USAGE,
  HID_REPORT_ID,
  HID_TIMEOUT_MS,
  HID_RETRY_COUNT,
  HID_RETRY_DELAY_MS,
  HID_OPEN_RETRY_COUNT,
  HID_OPEN_RETRY_DELAY_MS,
  VIAL_SERIAL_MAGIC,
  BOOTLOADER_SERIAL_MAGIC,
} from '../shared/constants/protocol'
import { logHidPacket } from './logger'
import type { DeviceInfo, DeviceType } from '../shared/types/protocol'
import * as bridgeService from './bridge-service'

let openDevice: HID.HIDAsync | null = null
let openDevicePath: string | null = null
let sendMutex: Promise<void> = Promise.resolve()
let usingBridge = false // true when the open device is via bridge tunnel

/**
 * Pad data to exactly MSG_LEN bytes, truncating or zero-filling as needed.
 */
function padToMsgLen(data: number[]): number[] {
  const padded = new Array<number>(MSG_LEN).fill(0)
  for (let i = 0; i < Math.min(data.length, MSG_LEN); i++) {
    padded[i] = data[i]
  }
  return padded
}

/**
 * Acquire the send mutex, returning { prev, release }.
 * Caller must chain on `prev` and call `release()` when done.
 */
function acquireMutex(): { prev: Promise<void>; release: () => void } {
  const prev = sendMutex
  let release: () => void
  sendMutex = new Promise<void>((resolve) => {
    release = resolve
  })
  return { prev, release: release! }
}

/**
 * Classify a device by serial number.
 * node-hid provides serial numbers directly, unlike WebHID in Electron.
 * Devices on the Vial usage page without recognized serial are assumed Vial.
 */
function classifyDevice(serialNumber: string): DeviceType {
  if (serialNumber.includes(BOOTLOADER_SERIAL_MAGIC)) return 'bootloader'
  if (serialNumber.includes(VIAL_SERIAL_MAGIC)) return 'vial'
  // Usage page 0xFF60 is Vial-specific; default to 'vial' when serial is unrecognized
  return 'vial'
}

/**
 * Normalize a read buffer to exactly MSG_LEN bytes.
 * node-hid may include report ID as the first byte on some platforms;
 * if the buffer is MSG_LEN + 1 and starts with the report ID, strip it.
 */
function normalizeResponse(buf: Buffer, expectedLen: number): number[] {
  // Strip leading report ID if present
  if (buf.length === expectedLen + 1 && buf[0] === HID_REPORT_ID) {
    return Array.from(buf.subarray(1, expectedLen + 1))
  }
  // Pad or truncate to expected length
  const result = new Array<number>(expectedLen).fill(0)
  for (let i = 0; i < Math.min(buf.length, expectedLen); i++) {
    result[i] = buf[i]
  }
  return result
}

/**
 * List available Vial/VIA HID devices.
 * Filters by usage page 0xFF60 and usage 0x61.
 */
export async function listDevices(): Promise<DeviceInfo[]> {
  const devices = await HID.devicesAsync()
  const result: DeviceInfo[] = []

  // Detect Keychron bridge/dongle devices first so we can exclude its raw FF60 interface
  const bridge = bridgeService.findBridgeDevice(devices)

  // Standard directly-connected devices
  for (const d of devices) {
    if (d.usagePage !== HID_USAGE_PAGE || d.usage !== HID_USAGE) continue
    if (bridge && d.path === bridge.viaPath) continue // Hide the raw bridge FF60 interface

    const serial = d.serialNumber ?? ''
    const type = classifyDevice(serial)
    result.push({
      vendorId: d.vendorId,
      productId: d.productId,
      productName: d.product ?? '',
      serialNumber: serial,
      type,
    })
  }
  if (bridge) {
    // Try to initialize the bridge and find connected keyboards
    const state = await bridgeService.openBridge(bridge.viaPath)
    if (state && state.connectedSlot !== null) {
      const connInfo = bridgeService.getConnectedDeviceInfo()
      if (connInfo) {
        // Check if this wireless device is already listed as a direct device
        // (it shouldn't be if it's wireless-only, but just in case)
        const alreadyListed = result.some(
          (r) => r.vendorId === connInfo.vid && r.productId === connInfo.pid,
        )
        if (!alreadyListed) {
          // Find the product name from the bridge slot's VID/PID
          const productName =
            devices.find((d) => d.vendorId === connInfo.vid && d.productId === connInfo.pid)
              ?.product ?? `Keychron (wireless via ${state.firmwareVersion || 'bridge'})`
          result.push({
            vendorId: connInfo.vid,
            productId: connInfo.pid,
            productName: `${productName} [2.4 GHz]`,
            serialNumber: `bridge:${bridge.viaPath}`,
            type: 'vial',
          })
        }
      }
    }
    // Close bridge after scanning — will reopen when user selects the device
    await bridgeService.closeBridge()
  }

  return result
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientError(err: Error): boolean {
  const msg = err.message.toLowerCase()
  return msg.includes('timeout') || msg.includes('could not read') || msg.includes('cannot write')
}

/**
 * Open a HID device by vendorId and productId.
 * If serialNumber starts with 'bridge:', opens via the Keychron 2.4 GHz bridge.
 * Uses device path for precise matching.
 * Retries with a delay to work around transient open failures on all platforms.
 */
export async function openHidDevice(
  vendorId: number,
  productId: number,
  serialNumber?: string,
): Promise<boolean> {
  if (openDevice || usingBridge) {
    await closeHidDevice()
  }

  // Bridge device — serial starts with 'bridge:'
  if (serialNumber?.startsWith('bridge:')) {
    const viaPath = serialNumber.slice('bridge:'.length)
    const state = await bridgeService.openBridge(viaPath)
    if (state && state.connectedSlot !== null) {
      usingBridge = true
      openDevicePath = `bridge:${viaPath}`
      openDevice = null // bridge handles its own HID device
      return true
    }
    return false
  }

  // Standard direct device open
  const devices = await HID.devicesAsync()
  const deviceInfo = devices.find(
    (d) =>
      d.vendorId === vendorId &&
      d.productId === productId &&
      d.usagePage === HID_USAGE_PAGE &&
      d.usage === HID_USAGE,
  )

  if (!deviceInfo?.path) return false

  for (let attempt = 0; attempt < HID_OPEN_RETRY_COUNT; attempt++) {
    try {
      openDevice = await HID.HIDAsync.open(deviceInfo.path)
      openDevicePath = deviceInfo.path
      usingBridge = false
      return true
    } catch (err) {
      if (attempt < HID_OPEN_RETRY_COUNT - 1) {
        await delay(HID_OPEN_RETRY_DELAY_MS)
      } else {
        throw err
      }
    }
  }

  return false
}

/**
 * Close the currently open HID device.
 */
export async function closeHidDevice(): Promise<void> {
  if (usingBridge) {
    await bridgeService.closeBridge()
    usingBridge = false
    openDevice = null
    openDevicePath = null
    return
  }
  if (openDevice) {
    try {
      openDevice.close()
    } catch {
      // Ignore close errors (device may already be disconnected)
    }
  }
  openDevice = null
  openDevicePath = null
}

/**
 * Validate IPC data: must be an array of bytes (0-255), length <= maxLen.
 */
export function validateHidData(data: unknown, maxLen: number): number[] {
  if (!Array.isArray(data)) {
    throw new Error('HID data must be an array')
  }
  if (data.length > maxLen) {
    throw new Error(`HID data exceeds maximum length of ${maxLen}`)
  }
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (typeof v !== 'number' || v < 0 || v > 255 || !Number.isInteger(v)) {
      throw new Error(`HID data byte at index ${i} is invalid: ${v}`)
    }
  }
  return data as number[]
}

/**
 * Send a 32-byte packet and receive a 32-byte response.
 * Serialized via mutex; retries on timeout up to HID_RETRY_COUNT times.
 */
export function sendReceive(data: number[]): Promise<number[]> {
  // Route through bridge if active
  if (usingBridge) {
    const { prev, release } = acquireMutex()
    return prev.then(async () => {
      try {
        logHidPacket('TX[bridge]', new Uint8Array(data))
        const result = await bridgeService.bridgeSendReceive(data)
        logHidPacket('RX[bridge]', new Uint8Array(result))
        return result
      } finally {
        release()
      }
    })
  }

  // Standard direct device path
  const { prev, release } = acquireMutex()

  return prev.then(async () => {
    try {
      if (!openDevice) {
        throw new Error('No HID device is open')
      }

      const padded = padToMsgLen(data)
      logHidPacket('TX', new Uint8Array(padded))

      let lastError: Error | undefined
      for (let attempt = 0; attempt < HID_RETRY_COUNT; attempt++) {
        try {
          openDevice.write([HID_REPORT_ID, ...padded])

          const response = await openDevice.read(HID_TIMEOUT_MS)
          if (!response || response.length === 0) {
            throw new Error('HID read timeout')
          }

          const result = normalizeResponse(response, MSG_LEN)
          logHidPacket('RX', new Uint8Array(result))
          return result
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          if (!isTransientError(lastError)) throw lastError
          if (attempt < HID_RETRY_COUNT - 1) {
            await delay(HID_RETRY_DELAY_MS)
          }
        }
      }
      throw lastError ?? new Error('HID send/receive failed')
    } finally {
      release()
    }
  })
}

/**
 * Send a packet without waiting for response.
 * Serialized via mutex to prevent interleaving with sendReceive.
 */
export function send(data: number[]): Promise<void> {
  // Route through bridge if active
  if (usingBridge) {
    const { prev, release } = acquireMutex()
    return prev.then(async () => {
      try {
        logHidPacket('TX[bridge]', new Uint8Array(data))
        await bridgeService.bridgeSend(data)
      } finally {
        release()
      }
    })
  }

  // Standard direct device path
  const { prev, release } = acquireMutex()

  return prev.then(async () => {
    try {
      if (!openDevice) {
        throw new Error('No HID device is open')
      }

      const padded = padToMsgLen(data)
      logHidPacket('TX', new Uint8Array(padded))
      await openDevice.write([HID_REPORT_ID, ...padded])
    } finally {
      release()
    }
  })
}

/**
 * Check if a device is currently open and physically present.
 * Re-enumerates USB devices to detect physical disconnection.
 */
export async function isDeviceOpen(): Promise<boolean> {
  if (usingBridge) {
    return bridgeService.isBridgePresent()
  }
  if (!openDevice || !openDevicePath) return false
  const devices = await HID.devicesAsync()
  const present = devices.some((d) => d.path === openDevicePath)
  if (!present) {
    await closeHidDevice()
  }
  return present
}
