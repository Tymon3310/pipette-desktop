// SPDX-License-Identifier: GPL-2.0-or-later
// WebHID Transport Implementation for Pipette Web
// Supports direct USB keyboards and Keychron 2.4 GHz wireless bridge/dongles (XOR 0x28 tunnel)

import {
  MSG_LEN,
  HID_USAGE_PAGE,
  HID_USAGE,
  HID_TIMEOUT_MS,
  VIAL_SERIAL_MAGIC,
  BOOTLOADER_SERIAL_MAGIC,
} from '../shared/constants/protocol'
import {
  BRIDGE_USAGE_PAGE,
  BRIDGE_USAGE,
  WIRELESS_RAW_HID_XOR_KEY,
} from '../shared/constants/bridge'
import type { DeviceInfo, DeviceType, ProbeResult } from '../shared/types/protocol'
import { setTransport } from '../preload/transport'

export let activeDevice: HIDDevice | null = null
export let activeIsBridge = false
let pendingResolver: ((data: Uint8Array) => void) | null = null
let sendMutex: Promise<void> = Promise.resolve()

export function isBridgeDevice(device: HIDDevice): boolean {
  if (device.vendorId === 0x3434) {
    if (device.productId >= 0xd000 && device.productId <= 0xdfff) return true
    const name = (device.productName || '').toLowerCase()
    if (name.includes('link') || name.includes('receiver') || name.includes('dongle')) return true
  }
  if (device.collections?.some((c) => c.usagePage === BRIDGE_USAGE_PAGE)) {
    return true
  }
  return false
}

export function getCollectionScore(device: HIDDevice): number {
  if (!device.collections || device.collections.length === 0) return 0
  let score = 0
  for (const c of device.collections) {
    if (c.usagePage === HID_USAGE_PAGE && c.usage === HID_USAGE) {
      return 100 // Top priority: 0xFF60:0x61 Raw HID
    }
    if (c.usagePage === HID_USAGE_PAGE) {
      score = Math.max(score, 90)
    }
    if (c.usagePage === BRIDGE_USAGE_PAGE) {
      score = Math.max(score, 80) // Bridge interface 0x8C
    }
    if (c.usagePage >= 0xff00 && c.usagePage <= 0xffff) {
      score = Math.max(score, 70) // Other vendor-defined page
    }
    if (c.usagePage === 0x01 && (c.usage === 0x06 || c.usage === 0x02)) {
      // Standard OS Keyboard (1:6) / Mouse (1:2) input — blocked by Chromium WebHID policy!
      return -100
    }
  }
  return score
}

function isRawHidDevice(device: HIDDevice): boolean {
  return getCollectionScore(device) > 0
}

function classifyDevice(serialNumber: string): DeviceType {
  if (serialNumber.includes(BOOTLOADER_SERIAL_MAGIC)) return 'bootloader'
  if (serialNumber.includes(VIAL_SERIAL_MAGIC)) return 'vial'
  return 'vial'
}

function mapDeviceInfo(device: HIDDevice): DeviceInfo {
  const isBridge = isBridgeDevice(device)
  const serial = device.serialNumber
    ? isBridge
      ? `bridge:${device.serialNumber}`
      : device.serialNumber
    : isBridge
      ? 'bridge:2.4g'
      : ''
  const name = device.productName || (isBridge ? 'Keychron Link [2.4 GHz]' : 'Vial Keyboard')
  const displayName = isBridge && !name.includes('[2.4 GHz]') ? `${name} [2.4 GHz]` : name

  return {
    vendorId: device.vendorId,
    productId: device.productId,
    productName: displayName,
    serialNumber: serial,
    type: classifyDevice(serial),
  }
}

function handleInputReport(event: HIDInputReportEvent): void {
  const view = event.data
  const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  const padded = new Uint8Array(MSG_LEN)
  padded.set(data.subarray(0, Math.min(data.length, MSG_LEN)))

  if (activeIsBridge) {
    // Filter out unsolicited bridge state notifications (0xBC / 0xE2)
    if (padded[0] === 0xbc || padded[0] === 0xe2) {
      console.log('[WebHID Bridge] State notification received:', Array.from(padded.subarray(0, 5)))
      return
    }
  }

  if (!pendingResolver) return
  const resolver = pendingResolver
  pendingResolver = null
  resolver(padded)
}

function padToMsgLen(data: Uint8Array): Uint8Array {
  if (data.length === MSG_LEN) return data
  const padded = new Uint8Array(MSG_LEN)
  padded.set(data.subarray(0, Math.min(data.length, MSG_LEN)))
  return padded
}

export function isWebHIDSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator
}

export async function listDevices(): Promise<DeviceInfo[]> {
  if (!isWebHIDSupported()) return []
  try {
    const rawDevices = await navigator.hid.getDevices()
    const allowedDevices = rawDevices.filter((d) => getCollectionScore(d) >= 0)
    const rawHidDevices = allowedDevices.filter(isRawHidDevice)
    const candidates = rawHidDevices.length > 0 ? rawHidDevices : allowedDevices

    // Deduplicate identical devices by VID:PID:Serial
    const seen = new Set<string>()
    const unique: DeviceInfo[] = []
    for (const d of candidates) {
      const key = `${d.vendorId}:${d.productId}:${d.serialNumber || ''}`
      if (!seen.has(key)) {
        seen.add(key)
        unique.push(mapDeviceInfo(d))
      }
    }
    return unique
  } catch (err) {
    console.warn('Failed to get WebHID devices:', err)
    return []
  }
}

export async function requestDevice(): Promise<DeviceInfo | null> {
  if (!isWebHIDSupported()) {
    throw new Error('WebHID is not supported in this browser. Please use Chrome, Edge, Brave, or Opera.')
  }
  try {
    const devices = await navigator.hid.requestDevice({
      filters: [
        { usagePage: HID_USAGE_PAGE, usage: HID_USAGE },
        { usagePage: HID_USAGE_PAGE },
        { usagePage: BRIDGE_USAGE_PAGE, usage: BRIDGE_USAGE },
        { usagePage: BRIDGE_USAGE_PAGE },
      ],
    })
    if (!devices || devices.length === 0) return null
    const target = devices.find((d) => getCollectionScore(d) > 0) || devices[0]
    return mapDeviceInfo(target)
  } catch (err) {
    console.warn('requestDevice cancelled or failed:', err)
    return null
  }
}

export async function openHidDevice(vendorId: number, productId: number, serialNumber?: string): Promise<boolean> {
  if (!isWebHIDSupported()) return false

  await closeHidDevice()

  const cleanSerial = serialNumber?.startsWith('bridge:') ? serialNumber.slice('bridge:'.length) : serialNumber
  const devices = await navigator.hid.getDevices()
  const matching = devices.filter(
    (d) =>
      d.vendorId === vendorId &&
      d.productId === productId &&
      (!cleanSerial || cleanSerial === '2.4g' || d.serialNumber === cleanSerial || d.serialNumber === serialNumber),
  )

  console.log(
    `[WebHID] Found ${matching.length} candidate(s) for VID=0x${vendorId.toString(16)} PID=0x${productId.toString(16)}:`,
    matching.map((m, idx) => ({
      idx,
      name: m.productName,
      opened: m.opened,
      score: getCollectionScore(m),
      collections: m.collections?.map((c) => ({
        usagePage: '0x' + c.usagePage.toString(16),
        usage: '0x' + c.usage.toString(16),
      })),
    })),
  )

  // Prioritize raw HID collections (score 100), then bridge (80), then vendor pages
  const sorted = [...matching].sort((a, b) => getCollectionScore(b) - getCollectionScore(a))

  for (const candidate of sorted) {
    if (getCollectionScore(candidate) < 0) {
      console.log('[WebHID] Skipping protected OS keyboard/mouse input candidate (score < 0)')
      continue
    }

    try {
      if (!candidate.opened) {
        await candidate.open()
      }
      candidate.removeEventListener('inputreport', handleInputReport)
      candidate.addEventListener('inputreport', handleInputReport)
      activeDevice = candidate
      activeIsBridge = isBridgeDevice(candidate)

      console.log(
        `[WebHID] Connected to candidate: ${candidate.productName} (score=${getCollectionScore(candidate)}, isBridge=${activeIsBridge})`,
      )

      if (activeIsBridge) {
        console.log('[WebHID] Initializing Keychron 2.4 GHz Bridge...')
        try {
          // Send FR_GET_PROTOCOL_VERSION (0xB1) - unencoded
          const verBuf = new Uint8Array(MSG_LEN)
          verBuf[0] = 0xb1
          await candidate.sendReport(0, verBuf)
          await new Promise((r) => setTimeout(r, 60))

          // Send FR_GET_STATE (0xB2) - unencoded
          const stateBuf = new Uint8Array(MSG_LEN)
          stateBuf[0] = 0xb2
          await candidate.sendReport(0, stateBuf)
          await new Promise((r) => setTimeout(r, 60))

          // Disable gamepad reports (0xB5, 0x00) - unencoded
          const gpBuf = new Uint8Array(MSG_LEN)
          gpBuf[0] = 0xb5
          gpBuf[1] = 0x00
          await candidate.sendReport(0, gpBuf)
          await new Promise((r) => setTimeout(r, 60))
          console.log('[WebHID] Keychron 2.4 GHz Bridge initialized successfully.')
        } catch (e) {
          console.warn('[WebHID] Bridge handshake failed on this collection (trying next):', e)
          await candidate.close()
          continue
        }
      }

      console.log(`[WebHID] Successfully activated device: ${candidate.productName}`)
      return true
    } catch (err) {
      console.warn('[WebHID] Error activating candidate:', err)
    }
  }

  // If none of the previously granted devices worked, prompt user specifically with raw HID / bridge filters
  try {
    console.log('[WebHID] Requesting new device handle with raw HID / bridge filters...')
    const requested = await navigator.hid.requestDevice({
      filters: [
        { vendorId, productId, usagePage: HID_USAGE_PAGE, usage: HID_USAGE },
        { vendorId, productId, usagePage: BRIDGE_USAGE_PAGE, usage: BRIDGE_USAGE },
        { vendorId, productId, usagePage: HID_USAGE_PAGE },
        { vendorId, productId, usagePage: BRIDGE_USAGE_PAGE },
      ],
    })
    if (requested && requested.length > 0) {
      const target = requested.find((d) => getCollectionScore(d) > 0) || requested[0]
      if (!target.opened) {
        await target.open()
      }
      target.addEventListener('inputreport', handleInputReport)
      activeDevice = target
      activeIsBridge = isBridgeDevice(target)
      return true
    }
  } catch (err) {
    console.warn('[WebHID] requestDevice cancelled or failed:', err)
  }

  return false
}

export async function closeHidDevice(): Promise<void> {
  if (activeDevice) {
    try {
      activeDevice.removeEventListener('inputreport', handleInputReport)
      if (activeDevice.opened) {
        await activeDevice.close()
      }
    } catch (err) {
      console.warn('Error closing WebHID device:', err)
    }
    activeDevice = null
  }
  activeIsBridge = false
  pendingResolver = null
}

export async function isDeviceOpen(): Promise<boolean> {
  return activeDevice !== null && activeDevice.opened
}

export async function sendReceive(data: Uint8Array): Promise<Uint8Array> {
  if (!activeDevice || !activeDevice.opened) {
    throw new Error('Device not connected')
  }

  const unlockPrev = sendMutex
  let releaseMutex: () => void
  sendMutex = new Promise<void>((resolve) => {
    releaseMutex = resolve
  })

  await unlockPrev

  try {
    const payload = padToMsgLen(data)
    const maxAttempts = activeIsBridge ? 4 : 1
    const timeoutMs = activeIsBridge ? 2000 : HID_TIMEOUT_MS

    let lastError: unknown = null

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
          pendingResolver = resolve
          setTimeout(() => {
            if (pendingResolver === resolve) {
              pendingResolver = null
              reject(new Error('HID sendReceive timeout'))
            }
          }, timeoutMs)
        })

        // Bridge protocol: tunnel VIA/Vial reports XOR-encoded with 0x28
        const toSend = activeIsBridge
          ? payload.map((b) => b ^ WIRELESS_RAW_HID_XOR_KEY)
          : payload

        await activeDevice.sendReport(0, toSend)
        const rawResp = await responsePromise

        if (activeIsBridge) {
          // Decode response
          const decoded = rawResp.map((b) => b ^ WIRELESS_RAW_HID_XOR_KEY)
          return decoded
        }
        return rawResp
      } catch (err) {
        lastError = err
        if (!activeDevice || !activeDevice.opened) {
          throw new Error('Device disconnected')
        }
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 150))
        }
      }
    }

    throw lastError || new Error('HID sendReceive timeout')
  } finally {
    releaseMutex!()
  }
}

export async function send(data: Uint8Array): Promise<void> {
  if (!activeDevice || !activeDevice.opened) {
    throw new Error('Device not connected')
  }
  const payload = padToMsgLen(data)
  const toSend = activeIsBridge
    ? payload.map((b) => b ^ WIRELESS_RAW_HID_XOR_KEY)
    : payload
  await activeDevice.sendReport(0, toSend)
}

export async function probeDevice(vendorId: number, productId: number, serialNumber?: string): Promise<ProbeResult> {
  const cleanSerial = serialNumber?.startsWith('bridge:') ? serialNumber.slice('bridge:'.length) : serialNumber
  const devices = await navigator.hid.getDevices()
  const match = devices.find(
    (d) =>
      d.vendorId === vendorId &&
      d.productId === productId &&
      (!cleanSerial || d.serialNumber === cleanSerial || d.serialNumber === serialNumber),
  )
  const serial = match?.serialNumber || serialNumber || ''
  return {
    type: classifyDevice(serial),
    vendorId,
    productId,
    productName: match?.productName || 'Vial Keyboard',
    serialNumber: serial,
  }
}

// Register this WebHID transport with the shared protocol layer
export function initWebTransport(): void {
  setTransport({
    sendReceive,
    send,
    probeDevice,
  })
}
