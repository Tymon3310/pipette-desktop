// SPDX-License-Identifier: GPL-2.0-or-later
// Keychron 2.4 GHz Bridge / Forza Receiver service.
// Handles detection and communication with wirelessly connected keyboards
// through the Keychron USB dongle.
//
// The bridge is detected via usage page 0x8C, but actual communication
// goes through the sibling 0xFF60 raw HID interface on the same USB device.
// All VIA/Vial traffic is XOR-encoded to avoid byte values that crash the
// LKBT51 wireless module.

import HID from 'node-hid'
import {
  FR_GET_PROTOCOL_VERSION,
  FR_GET_STATE,
  FR_GET_FW_VERSION,
  FR_CTL_GAMEPAD_RPT_ENABLE,
  FR_STATE_NOTIFY,
  FR_STATE_NOTIFY_ALT,
  BRIDGE_USAGE_PAGE,
  BRIDGE_USAGE,
  BRIDGE_FEAT_STATE_NOTIFY_OVER_VIA,
  BRIDGE_FEAT_VIA_DISABLE_GAMEPAD_INPUT,
  WIRELESS_RAW_HID_XOR_KEY,
} from '../shared/constants/bridge'
import {
  MSG_LEN,
  HID_USAGE_PAGE,
  HID_USAGE,
  HID_REPORT_ID,
  HID_TIMEOUT_MS,
} from '../shared/constants/protocol'

// ── Types ──────────────────────────────────────────────────────────

export interface BridgeDeviceSlot {
  vid: number
  pid: number
  connected: boolean
}

export interface BridgeState {
  protocolVersion: number
  featureFlags0: number
  featureFlags1: number
  firmwareVersion: string
  slots: BridgeDeviceSlot[]
  connectedSlot: number | null
  supportsStateNotify: boolean
}

// ── XOR encoding ───────────────────────────────────────────────────

function xorEncode(data: number[], key = WIRELESS_RAW_HID_XOR_KEY): number[] {
  return data.map((b) => b ^ key)
}

// ── Helpers ────────────────────────────────────────────────────────

function padToMsgLen(data: number[]): number[] {
  const padded = new Array<number>(MSG_LEN).fill(0)
  for (let i = 0; i < Math.min(data.length, MSG_LEN); i++) {
    padded[i] = data[i]
  }
  return padded
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeResponse(buf: Buffer, expectedLen: number): number[] {
  if (buf.length === expectedLen + 1 && buf[0] === HID_REPORT_ID) {
    return Array.from(buf.subarray(1, expectedLen + 1))
  }
  const result = new Array<number>(expectedLen).fill(0)
  for (let i = 0; i < Math.min(buf.length, expectedLen); i++) {
    result[i] = buf[i]
  }
  return result
}

// ── Bridge device ──────────────────────────────────────────────────

let bridgeDevice: HID.HIDAsync | null = null
let bridgeDevicePath: string | null = null
let bridgeState: BridgeState | null = null

/**
 * Send a raw 32-byte message to the bridge and read a 32-byte response.
 * Filters out unsolicited state notifications (0xBC / 0xE2).
 */
async function sendRaw(msg: number[], retries = 3): Promise<number[]> {
  if (!bridgeDevice) throw new Error('Bridge device not open')

  const padded = padToMsgLen(msg)
  let data: number[] = []
  let firstAttempt = true

  while (retries > 0) {
    retries--
    if (!firstAttempt) await delay(100)
    firstAttempt = false

    try {
      bridgeDevice.write([HID_REPORT_ID, ...padded])
      const response = await bridgeDevice.read(HID_TIMEOUT_MS)
      if (!response || response.length === 0) {
        continue
      }

      data = normalizeResponse(response, MSG_LEN)

      // Filter unsolicited state notifications
      if (data[0] === FR_STATE_NOTIFY || data[0] === FR_STATE_NOTIFY_ALT) {
        handleStateNotify(data)
        // Re-read for actual response
        const response2 = await bridgeDevice.read(HID_TIMEOUT_MS)
        if (!response2 || response2.length === 0) continue
        data = normalizeResponse(response2, MSG_LEN)
      }

      break
    } catch {
      continue
    }
  }

  if (data.length === 0) {
    throw new Error('Failed to communicate with bridge')
  }
  return data
}

/**
 * Handle an unsolicited 0xBC state notification from the bridge.
 */
function handleStateNotify(data: number[]): void {
  if (!bridgeState || data.length < 4) return
  // Update slot connection status
  if (bridgeState.slots.length >= 2) {
    bridgeState.slots[0].connected = !!data[1]
    bridgeState.slots[1].connected = !!data[2]
  }
  updateConnectedSlot()
}

function updateConnectedSlot(): void {
  if (!bridgeState) return
  bridgeState.connectedSlot = null
  for (let i = 0; i < bridgeState.slots.length; i++) {
    const slot = bridgeState.slots[i]
    if (slot.connected && (slot.vid !== 0 || slot.pid !== 0)) {
      bridgeState.connectedSlot = i
      break
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Scan for a Keychron bridge/dongle among enumerated HID devices.
 * If found, find its sibling 0xFF60 interface (on the same USB device)
 * for actual communication.
 *
 * Returns the DeviceInfo of the sibling 0xFF60 interface, or null.
 */
export function findBridgeDevice(
  allDevices: HID.Device[],
): { bridgePath: string; viaPath: string; vid: number; pid: number } | null {
  // 1. Find the bridge detection interface (usage page 0x8C)
  const bridgeDetect = allDevices.find(
    (d) => d.usagePage === BRIDGE_USAGE_PAGE && d.usage === BRIDGE_USAGE,
  )
  if (!bridgeDetect?.path) return null

  // 2. Find the sibling 0xFF60 raw HID interface on the same USB device
  // Match by VID/PID (the bridge exposes both interfaces)
  const viaInterface = allDevices.find(
    (d) =>
      d.vendorId === bridgeDetect.vendorId &&
      d.productId === bridgeDetect.productId &&
      d.usagePage === HID_USAGE_PAGE &&
      d.usage === HID_USAGE &&
      d.path !== bridgeDetect.path,
  )
  if (!viaInterface?.path) return null

  return {
    bridgePath: bridgeDetect.path,
    viaPath: viaInterface.path,
    vid: bridgeDetect.vendorId,
    pid: bridgeDetect.productId,
  }
}

/**
 * Open and initialize the bridge device.
 * Performs the handshake: protocol version, state, firmware version.
 *
 * @param viaPath - Path to the 0xFF60 interface (from findBridgeDevice)
 * @returns BridgeState if a keyboard is connected, null otherwise.
 */
export async function openBridge(viaPath: string): Promise<BridgeState | null> {
  if (bridgeDevice) {
    await closeBridge()
  }

  try {
    bridgeDevice = await HID.HIDAsync.open(viaPath)
    bridgeDevicePath = viaPath
  } catch {
    return null
  }

  const state: BridgeState = {
    protocolVersion: 0,
    featureFlags0: 0,
    featureFlags1: 0,
    firmwareVersion: '',
    slots: [],
    connectedSlot: null,
    supportsStateNotify: false,
  }

  // 1. Get protocol version and feature flags
  try {
    const data = await sendRaw([FR_GET_PROTOCOL_VERSION])
    if (data[0] === FR_GET_PROTOCOL_VERSION) {
      state.protocolVersion = (data[2] << 8) | data[1]
      state.featureFlags0 = data[3]
      state.featureFlags1 = data[4] ?? 0
      state.supportsStateNotify = !!(state.featureFlags0 & BRIDGE_FEAT_STATE_NOTIFY_OVER_VIA)
    }
  } catch {
    await closeBridge()
    return null
  }

  // 2. Get paired device slots
  try {
    const data = await sendRaw([FR_GET_STATE])
    if (data[0] === FR_GET_STATE) {
      for (let i = 0; i < 3; i++) {
        const base = 2 + i * 5
        if (base + 5 <= data.length) {
          const vid = data[base] | (data[base + 1] << 8)
          const pid = data[base + 2] | (data[base + 3] << 8)
          const connected = !!data[base + 4]
          state.slots.push({ vid, pid, connected })
        }
      }
    }
  } catch {
    await closeBridge()
    return null
  }

  // 3. Get firmware version (optional)
  try {
    const data = await sendRaw([FR_GET_FW_VERSION])
    if (data[0] === FR_GET_FW_VERSION) {
      const nullIdx = data.indexOf(0, 1)
      const end = nullIdx === -1 ? data.length : nullIdx
      state.firmwareVersion = String.fromCharCode(...data.slice(1, end))
    }
  } catch {
    // Not critical
  }

  // 4. Disable gamepad reports if supported
  if (state.featureFlags0 & BRIDGE_FEAT_VIA_DISABLE_GAMEPAD_INPUT) {
    try {
      await sendRaw([FR_CTL_GAMEPAD_RPT_ENABLE, 0])
    } catch {
      // Not critical
    }
  }

  // Find connected slot
  state.connectedSlot = null
  for (let i = 0; i < state.slots.length; i++) {
    const slot = state.slots[i]
    if (slot.connected && (slot.vid !== 0 || slot.pid !== 0)) {
      state.connectedSlot = i
      break
    }
  }

  bridgeState = state

  if (state.connectedSlot === null) {
    // No keyboard connected to bridge
    await closeBridge()
    return null
  }

  return state
}

/**
 * Close the bridge device.
 */
export async function closeBridge(): Promise<void> {
  if (bridgeDevice) {
    try {
      bridgeDevice.close()
    } catch {
      // Ignore
    }
  }
  bridgeDevice = null
  bridgeDevicePath = null
  bridgeState = null
}

/**
 * Send a VIA/Vial command through the bridge (XOR-encoded tunnel).
 * Same signature as sendReceive in hid-service — can be used as a drop-in.
 */
export async function bridgeSendReceive(data: number[]): Promise<number[]> {
  if (!bridgeDevice) throw new Error('Bridge device not open')

  const padded = padToMsgLen(data)
  const encoded = xorEncode(padded)
  const rawResp = await sendRaw(encoded, 3)
  return xorEncode(rawResp)
}

/**
 * Send without receiving (fire-and-forget through bridge).
 */
export async function bridgeSend(data: number[]): Promise<void> {
  if (!bridgeDevice) throw new Error('Bridge device not open')

  const padded = padToMsgLen(data)
  const encoded = xorEncode(padded)
  bridgeDevice.write([HID_REPORT_ID, ...padded.map((_, i) => encoded[i])])
}

/**
 * Check if a bridge device is currently open and has a connected keyboard.
 */
export function isBridgeOpen(): boolean {
  return bridgeDevice !== null && bridgeState?.connectedSlot !== null
}

/**
 * Check if the bridge device is still physically present.
 */
export async function isBridgePresent(): Promise<boolean> {
  if (!bridgeDevice || !bridgeDevicePath) return false
  const devices = await HID.devicesAsync()
  const present = devices.some((d) => d.path === bridgeDevicePath)
  if (!present) {
    await closeBridge()
  }
  return present
}

/**
 * Get the VID/PID of the wirelessly connected keyboard.
 */
export function getConnectedDeviceInfo(): { vid: number; pid: number } | null {
  if (!bridgeState || bridgeState.connectedSlot === null) return null
  const slot = bridgeState.slots[bridgeState.connectedSlot]
  if (!slot) return null
  return { vid: slot.vid, pid: slot.pid }
}

/**
 * Get current bridge state.
 */
export function getBridgeState(): BridgeState | null {
  return bridgeState
}
