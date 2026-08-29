// SPDX-License-Identifier: GPL-2.0-or-later
// node-hid based HID transport — runs in main process.
// Handles raw HID device enumeration, connection, and 32-byte packet I/O.

import HID from 'node-hid'
import {
  MSG_LEN,
  BUFFER_FETCH_CHUNK,
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
  CMD_VIA_GET_KEYBOARD_VALUE,
  CMD_VIA_GET_LAYER_COUNT,
  CMD_VIA_KEYMAP_GET_BUFFER,
  CMD_VIA_VIAL_PREFIX,
  VIA_LAYOUT_OPTIONS,
  CMD_VIAL_GET_KEYBOARD_ID,
  CMD_VIAL_GET_SIZE,
  CMD_VIAL_GET_DEFINITION,
  CMD_VIAL_GET_ENCODER,
} from '../shared/constants/protocol'
import { logHidPacket } from './logger'
import type { DeviceInfo, DeviceType, KeyboardDefinition, ProbeResult } from '../shared/types/protocol'
import { decompressLzma, decompressXz, hasXzMagic } from './lzma'
import * as bridgeService from './bridge-service'
import { parseDefinitionLayout } from '../shared/kle/definition-layout'
import {
  isVirtualDeviceEnabled,
  isVirtualDeviceExclusive,
  getVirtualDeviceInfo,
  matchesVirtualDevice,
  openVirtualDevice,
  closeVirtualDevice,
  isVirtualDeviceOpen,
  handleVirtualReport,
} from './virtual-device'

let openDevice: HID.HIDAsync | null = null
let openDevicePath: string | null = null
let sendMutex: Promise<void> = Promise.resolve()
let usingBridge = false

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
  // 'only' mode: hide real hardware so device lists (and doc screenshots)
  // are reproducible regardless of what is plugged into the workstation.
  if (isVirtualDeviceExclusive()) {
    return [getVirtualDeviceInfo()]
  }

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
    // If bridge is already open (active wireless connection), just report the connected device
    if (bridgeService.isBridgeOpen()) {
      const connInfo = bridgeService.getConnectedDeviceInfo()
      if (connInfo) {
        const productName =
          devices.find((d) => d.vendorId === connInfo.vid && d.productId === connInfo.pid)
            ?.product ?? 'Keychron (wireless)'
        result.push({
          vendorId: connInfo.vid,
          productId: connInfo.pid,
          productName: `${productName} [2.4 GHz]`,
          serialNumber: `bridge:${bridge.viaPath}`,
          type: 'vial',
        })
      }
      return result
    }
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

  if (isVirtualDeviceEnabled()) {
    result.push(getVirtualDeviceInfo())
  }

  return result
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientError(err: Error): boolean {
  const msg = err.message.toLowerCase()
  // "cannot write" and "could not read" on a disconnected device are NOT transient —
  // retrying just floods the mutex queue. Only timeout is worth retrying.
  return msg.includes('timeout')
}

/**
 * Open a HID device by vendorId and productId.
 * Uses device path for precise matching.
 * Retries with a delay to work around transient open failures on all platforms.
 */
export async function openHidDevice(
  vendorId: number,
  productId: number,
  serialNumber?: string,
): Promise<boolean> {
  if (openDevice || usingBridge || isVirtualDeviceOpen()) {
    await closeHidDevice()
  }

  if (isVirtualDeviceEnabled() && matchesVirtualDevice(vendorId, productId)) {
    await openVirtualDevice()
    return true
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

  // Always clear the virtual-open flag, not just when the feature flag is
  // currently set: sendReceive()/send()/isDeviceOpen() route on
  // isVirtualDeviceOpen() alone, so a stale open flag would keep hijacking
  // HID calls if the env var changes between open and close.
  closeVirtualDevice()
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
  // Route through bridge if active — bridge has its own retry logic (8 retries, 150ms delay, 1000ms timeout)
  if (usingBridge) {
    const { prev, release } = acquireMutex()
    return prev.then(async () => {
      try {
        logHidPacket('TX', new Uint8Array(data))
        const result = await bridgeService.bridgeSendReceive(data)
        logHidPacket('RX', new Uint8Array(result))
        return result
      } finally {
        release()
      }
    })
  }

  // Standard direct device path — aggressive retries for USB stability
  const { prev, release } = acquireMutex()

  return prev.then(async () => {
    try {
      if (isVirtualDeviceOpen()) {
        const padded = padToMsgLen(data)
        logHidPacket('TX', new Uint8Array(padded))
        const result = handleVirtualReport(padded)
        logHidPacket('RX', new Uint8Array(result))
        return result
      }

      if (!openDevice) {
        throw new Error('No HID device is open')
      }

      const padded = padToMsgLen(data)
      logHidPacket('TX', new Uint8Array(padded))

      let lastError: Error | undefined
      for (let attempt = 0; attempt < HID_RETRY_COUNT; attempt++) {
        try {
          await openDevice.write([HID_REPORT_ID, ...padded])

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
        logHidPacket('TX', new Uint8Array(data))
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
      if (isVirtualDeviceOpen()) {
        const padded = padToMsgLen(data)
        logHidPacket('TX', new Uint8Array(padded))
        handleVirtualReport(padded)
        return
      }

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
    // Bridge health check: try multiple times to account for wireless latency
    // This prevents false disconnect detection due to temporary wireless interference
    const HEALTH_CHECK_RETRIES = 3
    const HEALTH_CHECK_DELAY_MS = 500

    for (let attempt = 0; attempt < HEALTH_CHECK_RETRIES; attempt++) {
      const present = await bridgeService.isBridgePresent()
      if (present) return true

      // Wait before retry (except on last attempt)
      if (attempt < HEALTH_CHECK_RETRIES - 1) {
        await delay(HEALTH_CHECK_DELAY_MS)
      }
    }

    // All retries failed — bridge is truly gone
    await closeHidDevice()
    return false
  }
  if (isVirtualDeviceOpen()) return true
  if (!openDevice || !openDevicePath) return false
  const devices = await HID.devicesAsync()
  const present = devices.some((d) => d.path === openDevicePath)
  if (!present) {
    await closeHidDevice()
  }
  return present
}

/**
 * Probe a secondary keyboard device to read its keymap without affecting the primary connection.
 * Opens a temporary HID handle, reads protocol data, then closes.
 */
export async function probeDevice(vendorId: number, productId: number, serialNumber?: string): Promise<ProbeResult> {
  const devices = await HID.devicesAsync()
  const deviceInfo = devices.find(
    (d) =>
      d.vendorId === vendorId &&
      d.productId === productId &&
      d.usagePage === HID_USAGE_PAGE &&
      d.usage === HID_USAGE &&
      d.path !== openDevicePath && // Exclude the primary device
      (!serialNumber || (d.serialNumber ?? '') === serialNumber),
  )

  if (!deviceInfo?.path) {
    throw new Error('Probe target device not found')
  }

  const tempDevice = await HID.HIDAsync.open(deviceInfo.path)

  try {
    // Local send/receive helper for the temp device
    async function probeSendReceive(data: number[]): Promise<number[]> {
      const padded = padToMsgLen(data)
      tempDevice.write([HID_REPORT_ID, ...padded])
      const response = await tempDevice.read(HID_TIMEOUT_MS)
      if (!response || response.length === 0) {
        throw new Error('HID read timeout during probe')
      }
      return normalizeResponse(response, MSG_LEN)
    }

    // --- Protocol byte helpers (inlined because preload/protocol.ts variants use Uint8Array, not number[]) ---
    function readBE16(buf: number[], offset: number): number {
      return (buf[offset] << 8) | buf[offset + 1]
    }
    function readLE32(buf: number[], offset: number): number {
      return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | ((buf[offset + 3] << 24) >>> 0)
    }
    function readLE64Hex(buf: number[], offset: number): string {
      let hex = '0x'
      for (let i = 7; i >= 0; i--) {
        hex += buf[offset + i].toString(16).padStart(2, '0')
      }
      return hex
    }
    function readBE32(buf: number[], offset: number): number {
      return ((buf[offset] << 24) >>> 0) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]
    }
    function writeBE16(arr: number[], offset: number, value: number): void {
      arr[offset] = (value >> 8) & 0xff
      arr[offset + 1] = value & 0xff
    }
    function writeLE32(arr: number[], offset: number, value: number): void {
      arr[offset] = value & 0xff
      arr[offset + 1] = (value >> 8) & 0xff
      arr[offset + 2] = (value >> 16) & 0xff
      arr[offset + 3] = (value >> 24) & 0xff
    }
    function cmd(...bytes: number[]): number[] {
      return bytes
    }

    // 1. Get keyboard ID
    const idResp = await probeSendReceive(cmd(CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID))
    const vialProtocol = readLE32(idResp, 0)
    const uid = readLE64Hex(idResp, 4)

    // 2. Get definition
    const sizeResp = await probeSendReceive(cmd(CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_SIZE))
    const defSize = readLE32(sizeResp, 0)

    const blocks = Math.ceil(defSize / MSG_LEN)
    const compressedBuf = new Uint8Array(defSize)
    for (let block = 0; block < blocks; block++) {
      const pkt = new Array<number>(MSG_LEN).fill(0)
      pkt[0] = CMD_VIA_VIAL_PREFIX
      pkt[1] = CMD_VIAL_GET_DEFINITION
      writeLE32(pkt, 2, block)
      const resp = await probeSendReceive(pkt)
      const copyLen = Math.min(MSG_LEN, defSize - block * MSG_LEN)
      for (let i = 0; i < copyLen; i++) {
        compressedBuf[block * MSG_LEN + i] = resp[i]
      }
    }

    // 3. LZMA/XZ decompress
    const compressed = Buffer.from(compressedBuf)
    let jsonStr: string | null
    if (hasXzMagic(compressed)) {
      jsonStr = await decompressXz(compressed)
    } else {
      jsonStr = await decompressLzma(Array.from(compressed))
    }
    if (!jsonStr) {
      throw new Error('Failed to decompress keyboard definition')
    }
    const definition = JSON.parse(jsonStr) as KeyboardDefinition
    const name = definition.name ?? 'Unknown'
    const rows = definition.matrix.rows
    const cols = definition.matrix.cols

    // 4. Get layer count
    const layerResp = await probeSendReceive(cmd(CMD_VIA_GET_LAYER_COUNT))
    const layers = layerResp[1]

    // 5. Get keymap buffer (chunk read)
    const keymapSize = layers * rows * cols * 2 // 2 bytes per keycode (BE16)
    const keymapBuf: number[] = []
    for (let offset = 0; offset < keymapSize; offset += BUFFER_FETCH_CHUNK) {
      const chunkSize = Math.min(BUFFER_FETCH_CHUNK, keymapSize - offset)
      const pkt = new Array<number>(MSG_LEN).fill(0)
      pkt[0] = CMD_VIA_KEYMAP_GET_BUFFER
      writeBE16(pkt, 1, offset)
      pkt[3] = chunkSize
      const resp = await probeSendReceive(pkt)
      for (let i = 0; i < chunkSize; i++) {
        keymapBuf.push(resp[4 + i])
      }
    }

    // Convert buffer to keymap record
    const keymap: Record<string, number> = {}
    let bufIdx = 0
    for (let layer = 0; layer < layers; layer++) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const keycode = (keymapBuf[bufIdx] << 8) | keymapBuf[bufIdx + 1]
          keymap[`${layer},${row},${col}`] = keycode
          bufIdx += 2
        }
      }
    }

    // 6. Get layout options
    const layoutResp = await probeSendReceive(cmd(CMD_VIA_GET_KEYBOARD_VALUE, VIA_LAYOUT_OPTIONS))
    const layoutOptions = readBE32(layoutResp, 2)

    // 7. Get encoders — derive indices via the canonical KLE layout parser
    const encoderLayout: Record<string, number> = {}
    const { encoderIdx } = parseDefinitionLayout(definition)
    const encoderCount = encoderIdx.size
    for (const idx of encoderIdx) {
      for (let layer = 0; layer < layers; layer++) {
        const resp = await probeSendReceive(cmd(CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_ENCODER, layer, idx))
        encoderLayout[`${layer},${idx},0`] = readBE16(resp, 0)
        encoderLayout[`${layer},${idx},1`] = readBE16(resp, 2)
      }
    }

    return {
      uid,
      name,
      vialProtocol,
      definition,
      layers,
      rows,
      cols,
      keymap,
      encoderLayout,
      encoderCount,
      layoutOptions,
    }
  } finally {
    try {
      tempDevice.close()
    } catch {
      // Ignore close errors
    }
  }
}
