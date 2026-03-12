/**
 * Keychron-specific HID protocol implementation.
 * Runs in preload context, directly uses WebHID transport.
 *
 * Ported from vial-gui protocol/keychron.py — implements communication with
 * Keychron keyboards for features like dynamic debounce, Snap Click (SOCD),
 * per-key RGB, Analog Matrix (Hall Effect), wireless power management,
 * USB report rate, and NKRO toggle.
 *
 * All commands are 32-byte packets on the same raw HID endpoint as VIA/Vial
 * (Usage Page 0xFF60, Usage 0x61). Command ID is data[0].
 */

import { sendReceive } from './hid-transport'
import { MSG_LEN } from '../shared/constants/protocol'
import {
  KC_GET_PROTOCOL_VERSION,
  KC_GET_FIRMWARE_VERSION,
  KC_GET_SUPPORT_FEATURE,
  KC_GET_DEFAULT_LAYER,
  KC_MISC_CMD_GROUP,
  KC_KEYCHRON_RGB,
  KC_SUCCESS,
  MISC_GET_PROTOCOL_VER,
  DFU_INFO_GET,
  DEBOUNCE_GET,
  DEBOUNCE_SET,
  NKRO_GET,
  NKRO_SET,
  REPORT_RATE_GET,
  REPORT_RATE_SET,
  SNAP_CLICK_GET_INFO,
  SNAP_CLICK_GET,
  SNAP_CLICK_SET,
  SNAP_CLICK_SAVE,
  WIRELESS_LPM_GET,
  WIRELESS_LPM_SET,
  FEATURE_DEFAULT_LAYER,
  FEATURE_BLUETOOTH,
  FEATURE_P24G,
  FEATURE_ANALOG_MATRIX,
  FEATURE_DYNAMIC_DEBOUNCE,
  FEATURE_SNAP_CLICK,
  FEATURE_KEYCHRON_RGB,
  FEATURE_NKRO,
  MISC_DFU_INFO,
  MISC_DEBOUNCE,
  MISC_SNAP_CLICK,
  MISC_WIRELESS_LPM,
  MISC_REPORT_RATE,
  MISC_NKRO,
  RGB_GET_PROTOCOL_VER,
  RGB_SAVE,
  GET_INDICATORS_CONFIG,
  SET_INDICATORS_CONFIG,
  RGB_GET_LED_COUNT,
  RGB_GET_LED_IDX,
  PER_KEY_RGB_GET_TYPE,
  PER_KEY_RGB_SET_TYPE,
  PER_KEY_RGB_GET_COLOR,
  PER_KEY_RGB_SET_COLOR,
  PER_KEY_RGB_SOLID,
  MIXED_EFFECT_RGB_GET_INFO,
  MIXED_EFFECT_RGB_GET_REGIONS,
  MIXED_EFFECT_RGB_SET_REGIONS,
  MIXED_EFFECT_RGB_GET_EFFECT_LIST,
  MIXED_EFFECT_RGB_SET_EFFECT_LIST,
  REPORT_RATE_1000HZ,
  KC_ANALOG_MATRIX,
  AMC_GET_VERSION,
  AMC_GET_PROFILES_INFO,
  AMC_SELECT_PROFILE,
  AMC_SET_TRAVEL,
  AMC_SET_SOCD,
  AMC_SAVE_PROFILE,
  AMC_RESET_PROFILE,
  AMC_GET_GAME_CONTROLLER_MODE,
  AMC_SET_GAME_CONTROLLER_MODE,
  AMC_GET_CURVE,
  AMC_SET_CURVE,
  AMC_GET_PROFILE_RAW,
  AMC_CALIBRATE,
  AMC_GET_CALIBRATE_STATE,
  AMC_GET_REALTIME_TRAVEL,
  AMC_SET_PROFILE_NAME,
  AMC_SET_ADVANCE_MODE,
  ADV_MODE_CLEAR,
  ADV_MODE_OKMC,
  ADV_MODE_TOGGLE,
  BOOTLOADER_JUMP,
  BL_AWAIT_CONFIRM,
  BL_CONFIRMED,
  BL_TIMEOUT,
  BL_EXCEEDED,
  OKMC_ACTION_PRESS,
  OKMC_ACTION_RELEASE,
  OKMC_ACTION_NONE,
} from '../shared/constants/keychron'
import type {
  KeychronState,
  KeychronRGBState,
  KeychronAnalogState,
  SnapClickEntry,
  AnalogKeyConfig,
  OKMCSlotConfig,
  SOCDPair,
  OsIndicatorConfig,
  MixedRGBEffect,
  AnalogProfile,
} from '../shared/types/keychron'
import { emptyKeychronState } from '../shared/types/keychron'

// Unify all Keychron debug toggles if a global debug flag is set
if (process.env.DEBUG_KEYCHRON_ALL || process.env.DEBUG_FAKE_DEVICE) {
  process.env.DEBUG_KEYCHRON_ANALOG = '1'
  process.env.DEBUG_KEYCHRON_RGB = '1'
  process.env.DEBUG_KEYCHRON_SNAP_CLICK = '1'
  process.env.DEBUG_KEYCHRON_DEBOUNCE = '1'
  process.env.DEBUG_KEYCHRON_NKRO = '1'
  process.env.DEBUG_KEYCHRON_REPORT_RATE = '1'
  process.env.DEBUG_KEYCHRON_WIRELESS = '1'
}

// --- Packet helpers (match protocol.ts style) ---

/** Build a command packet (auto-padded to MSG_LEN). */
function cmd(...bytes: number[]): Uint8Array {
  const buf = new Uint8Array(MSG_LEN)
  for (let i = 0; i < bytes.length && i < MSG_LEN; i++) {
    buf[i] = bytes[i]
  }
  return buf
}

// =====================================================================
// Core detection commands
// =====================================================================

/**
 * Get Keychron protocol version.
 * Request: [0xA0]. Response: data[0]=echo, data[1]=version.
 * Returns -1 if 0xFF (not a Keychron keyboard).
 */
export async function getKeychronProtocolVersion(): Promise<number> {
  const resp = await sendReceive(cmd(KC_GET_PROTOCOL_VERSION))
  if (resp[0] === 0xff) return -1
  return resp[1]
}

/**
 * Get Keychron support feature flags.
 * Request: [0xA2]. Response: data[2]=byte0 flags, data[3]=byte1 flags.
 * Returns combined 16-bit flags, or 0 if unsupported.
 */
export async function getKeychronSupportFeature(): Promise<number> {
  const resp = await sendReceive(cmd(KC_GET_SUPPORT_FEATURE))
  if (resp[0] === 0xff) return 0
  return resp[2] | (resp[3] << 8)
}

/**
 * Get Keychron firmware version string.
 * Request: [0xA1]. Response: data[1..] null-terminated string.
 */
export async function getKeychronFirmwareVersion(): Promise<string> {
  const resp = await sendReceive(cmd(KC_GET_FIRMWARE_VERSION))
  if (resp[0] === 0xff) return ''
  // Extract null-terminated string from data[1..]
  const bytes: number[] = []
  for (let i = 1; i < resp.length; i++) {
    if (resp[i] === 0) break
    bytes.push(resp[i])
  }
  return String.fromCharCode(...bytes)
}

/**
 * Get MCU chip info via DFU_INFO_GET.
 * Request: [0xA7, 0x02]. Response: data[2]=success, data[3]=1(chip tag), data[4]=len, data[5..]=string.
 */
export async function getKeychronDfuInfo(): Promise<string> {
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, DFU_INFO_GET))
  if (
    resp[0] === KC_MISC_CMD_GROUP &&
    resp[1] === DFU_INFO_GET &&
    resp[2] === 0 && // success
    resp[3] === 1 // DFU_INFO_CHIP tag
  ) {
    const len = resp[4]
    const bytes: number[] = []
    for (let i = 0; i < len && 5 + i < resp.length; i++) {
      bytes.push(resp[5 + i])
    }
    return String.fromCharCode(...bytes)
  }
  return ''
}

/**
 * Get misc protocol version and feature flags.
 * Request: [0xA7, 0x01].
 * Response: data[3..4]=version(LE16), data[5..6]=features(LE16).
 */
export async function getKeychronMiscProtocol(): Promise<{
  version: number
  features: number
}> {
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, MISC_GET_PROTOCOL_VER))
  if (resp[0] === KC_MISC_CMD_GROUP && resp[1] === MISC_GET_PROTOCOL_VER) {
    return {
      version: resp[3] | (resp[4] << 8),
      features: resp[5] | (resp[6] << 8),
    }
  }
  return { version: 0, features: 0 }
}

/**
 * Get default layer (set by DIP switch).
 * Request: [0xA3]. Response: data[1]=layer index.
 */
export async function getKeychronDefaultLayer(): Promise<number> {
  const resp = await sendReceive(cmd(KC_GET_DEFAULT_LAYER))
  if (resp[0] === KC_GET_DEFAULT_LAYER) return resp[1]
  return -1
}

// =====================================================================
// Debounce
// =====================================================================

/** Get debounce settings. Returns { type, time }. */
export async function getKeychronDebounce(): Promise<{ type: number; time: number }> {
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, DEBOUNCE_GET))
  if (resp[0] === KC_MISC_CMD_GROUP && resp[1] === DEBOUNCE_GET && resp[2] === KC_SUCCESS) {
    return { type: resp[4], time: resp[5] }
  }
  return { type: 0, time: 5 }
}

/** Set debounce settings. Returns true on success. */
export async function setKeychronDebounce(
  debounceType: number,
  debounceTime: number,
): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_DEBOUNCE || process.env.DEBUG_KEYCHRON_ALL) return true
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, DEBOUNCE_SET, debounceType, debounceTime))
  return resp[0] === KC_MISC_CMD_GROUP && resp[1] === DEBOUNCE_SET && resp[2] === KC_SUCCESS
}

// =====================================================================
// NKRO
// =====================================================================

/** Get NKRO state. Returns { enabled, supported, adaptive }. */
export async function getKeychronNkro(): Promise<{
  enabled: boolean
  supported: boolean
  adaptive: boolean
}> {
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, NKRO_GET))
  if (resp[0] === KC_MISC_CMD_GROUP && resp[1] === NKRO_GET && resp[2] === KC_SUCCESS) {
    const flags = resp[3]
    return {
      enabled: !!(flags & 0x01),
      supported: !!(flags & 0x02),
      adaptive: !!(flags & 0x04),
    }
  }
  return { enabled: false, supported: false, adaptive: false }
}

/** Set NKRO enabled/disabled. Returns true on success. */
export async function setKeychronNkro(enabled: boolean): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_NKRO || process.env.DEBUG_KEYCHRON_ALL) return true
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, NKRO_SET, enabled ? 1 : 0))
  return resp[0] === KC_MISC_CMD_GROUP && resp[1] === NKRO_SET && resp[2] === KC_SUCCESS
}

// =====================================================================
// Report Rate
// =====================================================================

/**
 * Get report rate settings. Detects v1 (single) vs v2 (dual) format.
 * v2 is used when miscProtocolVersion === 3.
 */
export async function getKeychronReportRate(miscProtocolVersion: number): Promise<{
  pollRateVersion: number
  reportRate: number
  reportRateMask: number
  pollRateUsb: number
  pollRateUsbMask: number
  pollRate24g: number
  pollRate24gMask: number
}> {
  const isV2 = miscProtocolVersion === 3
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, REPORT_RATE_GET))

  if (resp[0] === KC_MISC_CMD_GROUP && resp[1] === REPORT_RATE_GET && resp[2] === KC_SUCCESS) {
    if (isV2) {
      // v2 dual rate: data[3]=current_usb, data[4]=support_usb,
      //               data[5]=support_fr, data[6]=current_fr
      const pollRateUsb = resp[3]
      const pollRateUsbMask = resp[4]
      const pollRate24gMask = resp[5]
      const pollRate24g = resp[6]
      return {
        pollRateVersion: 2,
        reportRate: pollRateUsb,
        reportRateMask: pollRateUsbMask,
        pollRateUsb,
        pollRateUsbMask,
        pollRate24g,
        pollRate24gMask,
      }
    } else {
      // v1 single rate: data[3]=rate, data[4]=support mask
      const rate = resp[3]
      const mask = resp[4]
      return {
        pollRateVersion: 1,
        reportRate: rate,
        reportRateMask: mask,
        pollRateUsb: rate,
        pollRateUsbMask: mask,
        pollRate24g: rate,
        pollRate24gMask: 0x7f,
      }
    }
  }

  return {
    pollRateVersion: isV2 ? 2 : 1,
    reportRate: REPORT_RATE_1000HZ,
    reportRateMask: 0x7f,
    pollRateUsb: REPORT_RATE_1000HZ,
    pollRateUsbMask: 0x7f,
    pollRate24g: REPORT_RATE_1000HZ,
    pollRate24gMask: 0x7f,
  }
}

/** Set report rate (v1 single rate). Returns true on success. */
export async function setKeychronReportRate(rate: number): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_REPORT_RATE || process.env.DEBUG_KEYCHRON_ALL) return true
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, REPORT_RATE_SET, rate))
  return resp[0] === KC_MISC_CMD_GROUP && resp[1] === REPORT_RATE_SET && resp[2] === KC_SUCCESS
}

/** Set dual polling rates (v2): separate USB and 2.4 GHz rates. */
export async function setKeychronPollRateV2(usbRate: number, frRate: number): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_REPORT_RATE || process.env.DEBUG_KEYCHRON_ALL) return true
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, REPORT_RATE_SET, usbRate, frRate))
  return resp[0] === KC_MISC_CMD_GROUP && resp[1] === REPORT_RATE_SET && resp[2] === KC_SUCCESS
}

// =====================================================================
// Snap Click (SOCD for regular keyboards)
// =====================================================================

/** Get Snap Click info. Returns the max count of configurable pairs. */
export async function getKeychronSnapClickInfo(): Promise<number> {
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, SNAP_CLICK_GET_INFO))
  if (resp[0] === KC_MISC_CMD_GROUP && resp[1] === SNAP_CLICK_GET_INFO && resp[2] === KC_SUCCESS) {
    return resp[3]
  }
  return 0
}

/**
 * Get all Snap Click entries.
 * Each entry is 3 bytes: (type, key1, key2). Fetches up to 8 per packet.
 */
export async function getKeychronSnapClickEntries(count: number): Promise<SnapClickEntry[]> {
  const entries: SnapClickEntry[] = []
  let idx = 0
  while (idx < count) {
    const batchSize = Math.min(8, count - idx)
    const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, SNAP_CLICK_GET, idx, batchSize))
    if (resp[0] === KC_MISC_CMD_GROUP && resp[1] === SNAP_CLICK_GET && resp[2] === KC_SUCCESS) {
      for (let i = 0; i < batchSize; i++) {
        const offset = 3 + i * 3
        entries.push({
          type: resp[offset],
          key1: resp[offset + 1],
          key2: resp[offset + 2],
        })
      }
    }
    idx += batchSize
  }
  return entries
}

/** Set a single Snap Click entry. Returns true on success. */
export async function setKeychronSnapClick(
  index: number,
  snapType: number,
  key1: number,
  key2: number,
): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_SNAP_CLICK || process.env.DEBUG_KEYCHRON_ALL) return true
  const resp = await sendReceive(
    cmd(KC_MISC_CMD_GROUP, SNAP_CLICK_SET, index, 1, snapType, key1 & 0xff, key2 & 0xff),
  )
  return resp[0] === KC_MISC_CMD_GROUP && resp[1] === SNAP_CLICK_SET && resp[2] === KC_SUCCESS
}

/** Save Snap Click settings to EEPROM. Returns true on success. */
export async function saveKeychronSnapClick(): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_SNAP_CLICK || process.env.DEBUG_KEYCHRON_ALL) return true
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, SNAP_CLICK_SAVE))
  return resp[0] === KC_MISC_CMD_GROUP && resp[1] === SNAP_CLICK_SAVE && resp[2] === KC_SUCCESS
}

// =====================================================================
// Wireless LPM (Low Power Management)
// =====================================================================

/** Get wireless LPM settings. Returns { backlitTime, idleTime } in seconds. */
export async function getKeychronWirelessLpm(): Promise<{
  backlitTime: number
  idleTime: number
}> {
  const resp = await sendReceive(cmd(KC_MISC_CMD_GROUP, WIRELESS_LPM_GET))
  if (resp[0] === KC_MISC_CMD_GROUP && resp[1] === WIRELESS_LPM_GET && resp[2] === KC_SUCCESS) {
    // data[3..4] = backlit_time LE16, data[5..6] = idle_time LE16
    const backlitTime = resp[3] | (resp[4] << 8)
    const idleTime = resp[5] | (resp[6] << 8)
    return { backlitTime, idleTime }
  }
  return { backlitTime: 30, idleTime: 300 }
}

/** Set wireless LPM settings. Returns true on success. */
export async function setKeychronWirelessLpm(
  backlitTime: number,
  idleTime: number,
): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_WIRELESS || process.env.DEBUG_KEYCHRON_ALL) return true
  const pkt = new Uint8Array(MSG_LEN)
  pkt[0] = KC_MISC_CMD_GROUP
  pkt[1] = WIRELESS_LPM_SET
  pkt[2] = backlitTime & 0xff
  pkt[3] = (backlitTime >> 8) & 0xff
  pkt[4] = idleTime & 0xff
  pkt[5] = (idleTime >> 8) & 0xff
  const resp = await sendReceive(pkt)
  return resp[0] === KC_MISC_CMD_GROUP && resp[1] === WIRELESS_LPM_SET && resp[2] === KC_SUCCESS
}

// =====================================================================
// Keychron RGB
// =====================================================================

/** Get RGB protocol version. */
export async function getKeychronRGBProtocolVersion(): Promise<number> {
  const resp = await sendReceive(cmd(KC_KEYCHRON_RGB, RGB_GET_PROTOCOL_VER))
  if (resp[0] === KC_KEYCHRON_RGB && resp[1] === RGB_GET_PROTOCOL_VER) {
    return resp[2]
  }
  return 0
}

/** Save Keychron RGB settings to EEPROM. */
export async function saveKeychronRGB(): Promise<void> {
  if (process.env.DEBUG_KEYCHRON_RGB || process.env.DEBUG_KEYCHRON_ALL) return
  await sendReceive(cmd(KC_KEYCHRON_RGB, RGB_SAVE))
}

/** Get OS indicator configuration. */
export async function getKeychronIndicators(): Promise<OsIndicatorConfig | null> {
  const resp = await sendReceive(cmd(KC_KEYCHRON_RGB, GET_INDICATORS_CONFIG))
  if (
    resp[0] === KC_KEYCHRON_RGB &&
    resp[1] === GET_INDICATORS_CONFIG &&
    resp[2] === 0 // status == success
  ) {
    return {
      availableMask: resp[3],
      disableMask: resp[4],
      hue: resp[5],
      sat: resp[6],
      val: resp[7],
    }
  }
  return null
}

/** Set OS indicator configuration. */
export async function setKeychronIndicators(
  disableMask: number,
  hue: number,
  sat: number,
  val: number,
): Promise<void> {
  if (process.env.DEBUG_KEYCHRON_RGB || process.env.DEBUG_KEYCHRON_ALL) return
  await sendReceive(cmd(KC_KEYCHRON_RGB, SET_INDICATORS_CONFIG, disableMask, hue, sat, val))
}

/** Get total LED count. */
export async function getKeychronLedCount(): Promise<number> {
  const resp = await sendReceive(cmd(KC_KEYCHRON_RGB, RGB_GET_LED_COUNT))
  if (
    resp[0] === KC_KEYCHRON_RGB &&
    resp[1] === RGB_GET_LED_COUNT &&
    resp[2] === 0 // status
  ) {
    return resp[3]
  }
  return 0
}

/**
 * Get LED index mapping (row,col → LED index).
 * Queries per-row using column bitmask, matching vial-gui's
 * reload_led_matrix_mapping() approach.
 */
export async function getKeychronLedMatrix(
  _ledCount: number,
  rows?: number,
  cols?: number,
): Promise<Map<string, number>> {
  const matrix = new Map<string, number>()
  // Need rows/cols to query per-row. If not provided, use sensible max.
  const maxRows = rows ?? 8
  const maxCols = cols ?? 24

  for (let row = 0; row < maxRows; row++) {
    const colMask = (1 << maxCols) - 1
    const pkt = new Uint8Array(MSG_LEN)
    pkt[0] = KC_KEYCHRON_RGB
    pkt[1] = RGB_GET_LED_IDX
    pkt[2] = row
    pkt[3] = colMask & 0xff
    pkt[4] = (colMask >> 8) & 0xff
    pkt[5] = (colMask >> 16) & 0xff
    pkt[6] = 0 // padding
    const resp = await sendReceive(pkt)
    if (
      resp[0] === KC_KEYCHRON_RGB &&
      resp[1] === RGB_GET_LED_IDX &&
      resp[2] === 0 // status
    ) {
      // LED indices start at data[3], one per column (0xFF = no LED)
      for (let col = 0; col < Math.min(maxCols, 24); col++) {
        const ledIdx = resp[3 + col]
        if (ledIdx !== 0xff) {
          matrix.set(`${row},${col}`, ledIdx)
        }
      }
    }
  }
  return matrix
}

/** Get per-key RGB effect type. */
export async function getKeychronPerKeyRGBType(): Promise<number> {
  const resp = await sendReceive(cmd(KC_KEYCHRON_RGB, PER_KEY_RGB_GET_TYPE))
  if (
    resp[0] === KC_KEYCHRON_RGB &&
    resp[1] === PER_KEY_RGB_GET_TYPE &&
    resp[2] === 0 // status
  ) {
    return resp[3]
  }
  return PER_KEY_RGB_SOLID
}

/** Set per-key RGB effect type. */
export async function setKeychronPerKeyRGBType(effectType: number): Promise<void> {
  if (process.env.DEBUG_KEYCHRON_RGB || process.env.DEBUG_KEYCHRON_ALL) return
  await sendReceive(cmd(KC_KEYCHRON_RGB, PER_KEY_RGB_SET_TYPE, effectType))
}

/**
 * Get all per-key RGB colors.
 * Returns array of [H, S, V] tuples. Fetches 9 LEDs per packet.
 */
export async function getKeychronPerKeyColors(
  ledCount: number,
): Promise<[number, number, number][]> {
  const colors: [number, number, number][] = []
  let idx = 0
  while (idx < ledCount) {
    const batch = Math.min(9, ledCount - idx)
    const pkt = new Uint8Array(MSG_LEN)
    pkt[0] = KC_KEYCHRON_RGB
    pkt[1] = PER_KEY_RGB_GET_COLOR
    pkt[2] = idx // 1-byte start index
    pkt[3] = batch
    const resp = await sendReceive(pkt)
    if (
      resp[0] === KC_KEYCHRON_RGB &&
      resp[1] === PER_KEY_RGB_GET_COLOR &&
      resp[2] === 0 // status
    ) {
      for (let i = 0; i < batch; i++) {
        const offset = 3 + i * 3
        colors.push([resp[offset], resp[offset + 1], resp[offset + 2]])
      }
    }
    idx += batch
  }
  return colors
}

/** Set a single per-key RGB color. */
export async function setKeychronPerKeyColor(
  ledIndex: number,
  h: number,
  s: number,
  v: number,
): Promise<void> {
  if (process.env.DEBUG_KEYCHRON_RGB || process.env.DEBUG_KEYCHRON_ALL) return
  // Protocol: [0xA8] [0x0A] [index] [1] [hue] [sat] [val]
  await sendReceive(cmd(KC_KEYCHRON_RGB, PER_KEY_RGB_SET_COLOR, ledIndex, 1, h, s, v))
}

/** Get Mixed RGB info: layers and effects per layer. */
export async function getKeychronMixedRGBInfo(): Promise<{
  layers: number
  effectsPerLayer: number
}> {
  const resp = await sendReceive(cmd(KC_KEYCHRON_RGB, MIXED_EFFECT_RGB_GET_INFO))
  if (
    resp[0] === KC_KEYCHRON_RGB &&
    resp[1] === MIXED_EFFECT_RGB_GET_INFO &&
    resp[2] === 0 // status
  ) {
    return { layers: resp[3], effectsPerLayer: resp[4] }
  }
  return { layers: 0, effectsPerLayer: 0 }
}

/** Get Mixed RGB region assignments. Returns array of region IDs per LED. */
export async function getKeychronMixedRGBRegions(ledCount: number): Promise<number[]> {
  const regions: number[] = []
  let idx = 0
  while (idx < ledCount) {
    // Max 29 regions per packet (32 - cmd - subcmd - status)
    const batch = Math.min(29, ledCount - idx)
    const pkt = new Uint8Array(MSG_LEN)
    pkt[0] = KC_KEYCHRON_RGB
    pkt[1] = MIXED_EFFECT_RGB_GET_REGIONS
    pkt[2] = idx // start index
    pkt[3] = batch
    const resp = await sendReceive(pkt)
    if (
      resp[0] === KC_KEYCHRON_RGB &&
      resp[1] === MIXED_EFFECT_RGB_GET_REGIONS &&
      resp[2] === 0 // status
    ) {
      for (let i = 0; i < batch; i++) {
        regions.push(resp[3 + i])
      }
    } else {
      break
    }
    idx += batch
  }
  return regions
}

/** Set Mixed RGB region assignments. */
export async function setKeychronMixedRGBRegions(
  startIndex: number,
  regions: number[],
): Promise<void> {
  if (process.env.DEBUG_KEYCHRON_RGB || process.env.DEBUG_KEYCHRON_ALL) return
  let idx = 0
  while (idx < regions.length) {
    // Max 28 per packet (32 - cmd - subcmd - start - count)
    const batch = Math.min(28, regions.length - idx)
    const pkt = new Uint8Array(MSG_LEN)
    pkt[0] = KC_KEYCHRON_RGB
    pkt[1] = MIXED_EFFECT_RGB_SET_REGIONS
    pkt[2] = startIndex + idx
    pkt[3] = batch
    for (let i = 0; i < batch; i++) {
      pkt[4 + i] = regions[idx + i]
    }
    await sendReceive(pkt)
    idx += batch
  }
}

/**
 * Get Mixed RGB effect list for a region.
 * Each effect is 8 bytes: {effect, hue, sat, speed, time(LE32)}.
 * Max 3 effects per packet (3×8 = 24 bytes).
 */
export async function getKeychronMixedRGBEffects(
  regionIndex: number,
  effectsPerLayer: number,
): Promise<MixedRGBEffect[]> {
  const effects: MixedRGBEffect[] = []
  let idx = 0
  while (idx < effectsPerLayer) {
    const batch = Math.min(3, effectsPerLayer - idx)
    const pkt = new Uint8Array(MSG_LEN)
    pkt[0] = KC_KEYCHRON_RGB
    pkt[1] = MIXED_EFFECT_RGB_GET_EFFECT_LIST
    pkt[2] = regionIndex
    pkt[3] = idx
    pkt[4] = batch
    const resp = await sendReceive(pkt)
    if (
      resp[0] === KC_KEYCHRON_RGB &&
      resp[1] === MIXED_EFFECT_RGB_GET_EFFECT_LIST &&
      resp[2] === 0 // status
    ) {
      for (let i = 0; i < batch; i++) {
        const off = 3 + i * 8
        effects.push({
          effect: resp[off],
          hue: resp[off + 1],
          sat: resp[off + 2],
          speed: resp[off + 3],
          time:
            resp[off + 4] | (resp[off + 5] << 8) | (resp[off + 6] << 16) | (resp[off + 7] << 24),
        })
      }
    } else {
      break
    }
    idx += batch
  }
  return effects
}

/**
 * Set Mixed RGB effect list for a region.
 * Each effect is 8 bytes: {effect, hue, sat, speed, time(LE32)}.
 */
export async function setKeychronMixedRGBEffects(
  regionIndex: number,
  startIndex: number,
  effects: MixedRGBEffect[],
): Promise<void> {
  if (process.env.DEBUG_KEYCHRON_RGB || process.env.DEBUG_KEYCHRON_ALL) return
  let idx = 0
  while (idx < effects.length) {
    // Max 3 per packet
    const batch = Math.min(3, effects.length - idx)
    const pkt = new Uint8Array(MSG_LEN)
    pkt[0] = KC_KEYCHRON_RGB
    pkt[1] = MIXED_EFFECT_RGB_SET_EFFECT_LIST
    pkt[2] = regionIndex
    pkt[3] = startIndex + idx
    pkt[4] = batch
    for (let i = 0; i < batch; i++) {
      const eff = effects[idx + i]
      const off = 5 + i * 8
      pkt[off] = eff.effect
      pkt[off + 1] = eff.hue
      pkt[off + 2] = eff.sat
      pkt[off + 3] = eff.speed
      pkt[off + 4] = eff.time & 0xff
      pkt[off + 5] = (eff.time >> 8) & 0xff
      pkt[off + 6] = (eff.time >> 16) & 0xff
      pkt[off + 7] = (eff.time >> 24) & 0xff
    }
    await sendReceive(pkt)
    idx += batch
  }
}

// =====================================================================
// Analog Matrix
// =====================================================================

/** Get Analog Matrix firmware version. */
export async function getKeychronAnalogVersion(): Promise<number> {
  const resp = await sendReceive(cmd(KC_ANALOG_MATRIX, AMC_GET_VERSION))
  if (resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_GET_VERSION) {
    return resp[2]
  }
  return 0
}

/** Get Analog Matrix profile counts and size. */
export async function getKeychronAnalogProfilesInfo(): Promise<{
  currentProfile: number
  profileCount: number
  profileSize: number
  okmcCount: number
  socdCount: number
}> {
  const resp = await sendReceive(cmd(KC_ANALOG_MATRIX, AMC_GET_PROFILES_INFO))
  if (resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_GET_PROFILES_INFO) {
    return {
      currentProfile: resp[2],
      profileCount: resp[3],
      profileSize: resp[4] | (resp[5] << 8),
      okmcCount: resp[6],
      socdCount: resp[7],
    }
  }
  return {
    currentProfile: 0,
    profileCount: 0,
    profileSize: 0,
    okmcCount: 0,
    socdCount: 0,
  }
}

/** Get Analog Matrix joystick response curve. */
export async function getKeychronAnalogCurve(): Promise<number[]> {
  const resp = await sendReceive(cmd(KC_ANALOG_MATRIX, AMC_GET_CURVE))
  const curve: number[] = []
  if (resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_GET_CURVE) {
    for (let i = 0; i < 4; i++) {
      curve.push(resp[2 + i * 2])
      curve.push(resp[3 + i * 2])
    }
  }
  return curve
}

/** Set Analog Matrix joystick response curve. */
export async function setKeychronAnalogCurve(curvePoints: number[]): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_ANALOG || process.env.DEBUG_KEYCHRON_ALL) return true
  if (curvePoints.length !== 8) return false
  const packet = cmd(KC_ANALOG_MATRIX, AMC_SET_CURVE)
  for (let i = 0; i < 8; i++) {
    packet[i + 2] = curvePoints[i] ?? 0
  }
  const resp = await sendReceive(packet)
  return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_SET_CURVE
}

/** Get Game Controller Mode for Analog. */
export async function getKeychronAnalogGameControllerMode(): Promise<number> {
  const resp = await sendReceive(cmd(KC_ANALOG_MATRIX, AMC_GET_GAME_CONTROLLER_MODE))
  if (
    resp[0] === KC_ANALOG_MATRIX &&
    resp[1] === AMC_GET_GAME_CONTROLLER_MODE &&
    resp[2] === KC_SUCCESS
  ) {
    return resp[3]
  }
  return 0
}

/** Select Analog Profile. */
export async function setKeychronAnalogProfile(profileIndex: number): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_ANALOG) return true
  const resp = await sendReceive(cmd(KC_ANALOG_MATRIX, AMC_SELECT_PROFILE, profileIndex, 0, 0, 0, 0))
  return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_SELECT_PROFILE && resp[2] === KC_SUCCESS
}

/** Set Analog Travel/Actuation. */
export async function setKeychronAnalogTravel(
  profile: number,
  mode: number,
  actPt: number,
  sens: number,
  rlsSens: number,
  entire: boolean,
  rowMask?: number[],
): Promise<boolean> {
  if (entire) {
    const resp = await sendReceive(
      cmd(KC_ANALOG_MATRIX, AMC_SET_TRAVEL, profile, mode, actPt, sens, rlsSens, 1, 0),
    )
    return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_SET_TRAVEL && resp[2] === KC_SUCCESS
  } else {
    // Requires mapping row masks
    const pkt = new Uint8Array(MSG_LEN)
    pkt[0] = KC_ANALOG_MATRIX
    pkt[1] = AMC_SET_TRAVEL
    pkt[2] = profile
    pkt[3] = mode
    pkt[4] = actPt
    pkt[5] = sens
    pkt[6] = rlsSens
    pkt[7] = 0 // entire=0
    if (rowMask) {
      let offset = 8
      for (const mask of rowMask) {
        if (offset + 2 < MSG_LEN) {
          pkt[offset] = mask & 0xff
          pkt[offset + 1] = (mask >> 8) & 0xff
          pkt[offset + 2] = (mask >> 16) & 0xff
          offset += 3
        }
      }
    }
    const resp = await sendReceive(pkt)
    return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_SET_TRAVEL && resp[2] === KC_SUCCESS
  }
}

/** Set SOCD pair for analog keyboard. */
export async function setKeychronAnalogSocd(
  profile: number,
  row1: number,
  col1: number,
  row2: number,
  col2: number,
  index: number,
  pair: SOCDPair,
): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_ANALOG) return true
  const resp = await sendReceive(
    cmd(KC_ANALOG_MATRIX, AMC_SET_SOCD, profile, row1, col1, row2, col2, index, pair.socdType),
  )
  return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_SET_SOCD && resp[2] === KC_SUCCESS
}

/** Save Analog Profile to EEPROM. */
export async function saveKeychronAnalogProfile(profile: number): Promise<boolean> {
  const resp = await sendReceive(cmd(KC_ANALOG_MATRIX, AMC_SAVE_PROFILE, profile))
  return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_SAVE_PROFILE && resp[2] === KC_SUCCESS
}

/** Reset Analog Profile to defaults. */
export async function resetKeychronAnalogProfile(profile: number): Promise<boolean> {
  const resp = await sendReceive(cmd(KC_ANALOG_MATRIX, AMC_RESET_PROFILE, profile))
  return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_RESET_PROFILE && resp[2] === KC_SUCCESS
}

/** Set Game Controller Mode. */
export async function setKeychronAnalogGameControllerMode(mode: number): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_ANALOG) return true
  const resp = await sendReceive(cmd(KC_ANALOG_MATRIX, AMC_SET_GAME_CONTROLLER_MODE, mode))
  return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_SET_GAME_CONTROLLER_MODE
}

/** Read raw profile data. */
export async function getKeychronAnalogProfileRaw(
  profile: number,
  offset: number,
  size: number,
): Promise<number[]> {
  const actualSize = Math.min(size, 26) // Limit to 26 max due to 32 byte packet - 6 header
  const resp = await sendReceive(
    cmd(
      KC_ANALOG_MATRIX,
      AMC_GET_PROFILE_RAW,
      profile,
      offset & 0xff,
      (offset >> 8) & 0xff,
      actualSize,
    ),
  )
  const result: number[] = []
  if (resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_GET_PROFILE_RAW) {
    for (let i = 0; i < actualSize; i++) {
      result.push(resp[6 + i])
    }
  }
  return result
}

/** Start calibration process. */
export async function startKeychronCalibration(calibType: number): Promise<boolean> {
  const resp = await sendReceive(cmd(KC_ANALOG_MATRIX, AMC_CALIBRATE, calibType))
  return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_CALIBRATE && resp[2] === KC_SUCCESS
}

/** Get current calibration state. */
export async function getKeychronCalibrationState(): Promise<{
  calibrated: number
  state: number
} | null> {
  const resp = await sendReceive(cmd(KC_ANALOG_MATRIX, AMC_GET_CALIBRATE_STATE))
  if (resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_GET_CALIBRATE_STATE) {
    return {
      calibrated: resp[2],
      state: resp[3],
    }
  }
  return null
}

/** Get real-time travel value for a key. */
export async function getKeychronRealtimeTravel(
  row: number,
  col: number,
): Promise<{
  row: number
  col: number
  travelMm: number
  travelRaw: number
  value: number
  zero: number
  full: number
  state: number
} | null> {
  const resp = await sendReceive(cmd(KC_ANALOG_MATRIX, AMC_GET_REALTIME_TRAVEL, row, col))
  if (
    resp[0] === KC_ANALOG_MATRIX &&
    resp[1] === AMC_GET_REALTIME_TRAVEL &&
    resp[2] === KC_SUCCESS
  ) {
    return {
      row: resp[3],
      col: resp[4],
      travelMm: resp[5],
      travelRaw: resp[6],
      value: resp[7] | (resp[8] << 8),
      zero: resp[9] | (resp[10] << 8),
      full: resp[11] | (resp[12] << 8),
      state: resp[13],
    }
  }
  return null
}

/** Set the profile name. */
export async function setKeychronAnalogProfileName(
  profile: number,
  name: string,
): Promise<boolean> {
  if (process.env.DEBUG_KEYCHRON_ANALOG) return true

  // Standard limit is 30 bytes for the name
  const MAX_LEN = 30
  const nameBytes = new TextEncoder().encode(name)
  const actualLen = Math.min(nameBytes.length, MAX_LEN)
  const pkt = new Uint8Array(MSG_LEN)
  pkt[0] = KC_ANALOG_MATRIX
  pkt[1] = AMC_SET_PROFILE_NAME
  pkt[2] = profile
  pkt[3] = actualLen
  for (let i = 0; i < actualLen; i++) {
    pkt[4 + i] = nameBytes[i]
  }
  const resp = await sendReceive(pkt)
  return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_SET_PROFILE_NAME && resp[2] === KC_SUCCESS
}

/** Clear advance mode from a key. */
export async function setKeychronAnalogAdvanceModeClear(
  profile: number,
  row: number,
  col: number,
): Promise<boolean> {
  const resp = await sendReceive(
    cmd(
      KC_ANALOG_MATRIX,
      AMC_SET_ADVANCE_MODE,
      profile,
      ADV_MODE_CLEAR, // Note: Need to import ADV_MODE_CLEAR and others
      row,
      col,
      0,
    ),
  )
  return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_SET_ADVANCE_MODE && resp[2] === KC_SUCCESS
}

/** Set DKS advance mode on a key. */
export async function setKeychronAnalogAdvanceModeDks(
  profile: number,
  row: number,
  col: number,
  okmcIndex: number,
  shallowAct: number,
  shallowDeact: number,
  deepAct: number,
  deepDeact: number,
  keycodes: number[], // Array of 4 uint16 numbers
  actions: number[], // Array of 4 uint8 actions
): Promise<boolean> {
  const pkt = new Uint8Array(MSG_LEN)
  pkt[0] = KC_ANALOG_MATRIX
  pkt[1] = AMC_SET_ADVANCE_MODE
  pkt[2] = profile
  pkt[3] = ADV_MODE_OKMC // Need to import
  pkt[4] = row
  pkt[5] = col
  pkt[6] = okmcIndex
  pkt[7] = shallowAct
  pkt[8] = shallowDeact
  pkt[9] = deepAct
  pkt[10] = deepDeact

  // Pack keycodes
  for (let i = 0; i < 4; i++) {
    const kc = keycodes[i] || 0
    pkt[11 + i * 2] = kc & 0xff
    pkt[12 + i * 2] = (kc >> 8) & 0xff
  }

  // Pack actions
  for (let i = 0; i < 4; i++) {
    const action = actions[i] || 0
    pkt[19 + i] = action
  }

  const resp = await sendReceive(pkt)
  return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_SET_ADVANCE_MODE && resp[2] === KC_SUCCESS
}

// =====================================================================
// Analog Profile Parsing Helpers
// =====================================================================

/** Parse a 4-byte analog_key_config_t structure. */
function parseAnalogKeyConfig(
  data: Uint8Array,
  offset: number,
  globalConfig?: AnalogKeyConfig,
): AnalogKeyConfig {
  if (data.length < offset + 4) {
    return { mode: 1, actuationPoint: 20, sensitivity: 3, releaseSensitivity: 3 }
  }

  const byte0 = data[offset]
  const byte1 = data[offset + 1]
  const byte2 = data[offset + 2]
  const byte3 = data[offset + 3]

  const mode = byte0 & 0x03
  const actPt = (byte0 >> 2) & 0x3f
  const rpdTrigSen = byte1 & 0x3f
  const rpdTrigSenDeact = ((byte1 >> 6) & 0x03) | ((byte2 & 0x0f) << 2)
  const advMode = (byte2 >> 4) & 0x0f
  const advModeData = byte3

  const config: AnalogKeyConfig & { advMode: number; advModeData: number } = {
    mode: mode > 0 ? mode : 1, // Treat 0 (global) as regular if no global provided
    actuationPoint: actPt > 0 ? actPt : 20,
    sensitivity: rpdTrigSen > 0 ? rpdTrigSen : 3,
    releaseSensitivity: rpdTrigSenDeact > 0 ? rpdTrigSenDeact : 3,
    advMode,
    advModeData,
  }

  // Inherit from global if needed
  if (globalConfig) {
    if (mode === 0) config.mode = globalConfig.mode
    if (actPt === 0) config.actuationPoint = globalConfig.actuationPoint
    if (rpdTrigSen === 0) config.sensitivity = globalConfig.sensitivity
    if (rpdTrigSenDeact === 0) config.releaseSensitivity = globalConfig.releaseSensitivity
  }

  return config
}

/** Read all per-key actuation configurations from a profile. */
export async function getKeychronAnalogKeyConfigs(
  profile: number,
  rows: number,
  cols: number,
): Promise<Map<string, AnalogKeyConfig & { advMode: number; advModeData: number }>> {
  if (rows === 0 || cols === 0) return new Map()

  const globalOffset = 0
  const perKeyOffset = 4
  const perKeySize = rows * cols * 4

  // Read global config
  const globalData = await getKeychronAnalogProfileRaw(profile, globalOffset, 4)
  if (!globalData || globalData.length < 4) return new Map()

  const globalConfig = parseAnalogKeyConfig(new Uint8Array(globalData), 0)

  // Read per-key configs in chunks
  const allData = new Uint8Array(perKeySize)
  let offset = perKeyOffset
  let remaining = perKeySize
  let writeOffset = 0

  while (remaining > 0) {
    const chunkSize = Math.min(24, remaining)
    const chunk = await getKeychronAnalogProfileRaw(profile, offset, chunkSize)
    if (!chunk || chunk.length === 0) break
    allData.set(chunk, writeOffset)
    writeOffset += chunk.length
    offset += chunk.length
    remaining -= chunk.length
  }

  const keyConfigs = new Map<string, AnalogKeyConfig & { advMode: number; advModeData: number }>()
  let idx = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (idx + 4 <= writeOffset) {
        keyConfigs.set(`${r},${c}`, parseAnalogKeyConfig(allData, idx, globalConfig))
        idx += 4
      } else {
        keyConfigs.set(`${r},${c}`, {
          mode: globalConfig.mode,
          actuationPoint: globalConfig.actuationPoint,
          sensitivity: globalConfig.sensitivity,
          releaseSensitivity: globalConfig.releaseSensitivity,
          advMode: 0,
          advModeData: 0,
        })
      }
    }
  }

  return keyConfigs
}

/** Read OKMC (DKS) slot configurations. */
export async function getKeychronAnalogOkmcConfigs(
  profile: number,
  rows: number,
  cols: number,
  okmcCount: number,
): Promise<OKMCSlotConfig[]> {
  if (okmcCount === 0) return []

  const okmcOffset = 4 + rows * cols * 4
  const okmcTotal = okmcCount * 19

  const allData = new Uint8Array(okmcTotal)
  let offset = okmcOffset
  let remaining = okmcTotal
  let writeOffset = 0

  while (remaining > 0) {
    const chunkSize = Math.min(19, remaining)
    const chunk = await getKeychronAnalogProfileRaw(profile, offset, chunkSize)
    if (!chunk || chunk.length === 0) break
    allData.set(chunk, writeOffset)
    writeOffset += chunk.length
    offset += chunk.length
    remaining -= chunk.length
  }

  const result: OKMCSlotConfig[] = []
  for (let i = 0; i < okmcCount; i++) {
    const base = i * 19
    if (base + 19 > writeOffset) break

    // We only strictly need the raw keycodes and events array for the UI right now,
    // but parsing travel is useful if we edit it. The UI can handle the raw `events` array.
    const keycodes: number[] = []
    const events: number[] = []

    const shallowAct = allData[base + 0]
    const shallowDeact = allData[base + 1]
    const deepAct = allData[base + 2]
    const deepDeact = allData[base + 3]

    // keycodes: 4 x uint16 LE
    for (let j = 0; j < 4; j++) {
      keycodes.push(allData[base + 4 + j * 2] | (allData[base + 5 + j * 2] << 8))
    }

    // actions: 4 x 2 bytes
    for (let j = 0; j < 8; j++) {
      events.push(allData[base + 12 + j])
    }

    result.push({ shallowAct, shallowDeact, deepAct, deepDeact, keycodes, events })
  }

  return result
}

/** Read SOCD pair configurations. */
export async function getKeychronAnalogSocdPairs(
  profile: number,
  rows: number,
  cols: number,
  okmcCount: number,
  socdCount: number,
): Promise<SOCDPair[]> {
  if (socdCount === 0) return []

  const socdOffset = 4 + rows * cols * 4 + okmcCount * 19
  const socdDataSize = socdCount * 3

  const allData = new Uint8Array(socdDataSize)
  let offset = socdOffset
  let remaining = socdDataSize
  let writeOffset = 0

  while (remaining > 0) {
    const chunkSize = Math.min(24, remaining)
    const chunk = await getKeychronAnalogProfileRaw(profile, offset, chunkSize)
    if (!chunk || chunk.length === 0) break
    allData.set(chunk, writeOffset)
    writeOffset += chunk.length
    offset += chunk.length
    remaining -= chunk.length
  }

  const socdPairs: SOCDPair[] = []
  for (let i = 0; i < socdCount; i++) {
    const idx = i * 3
    if (idx + 3 <= writeOffset) {
      const b0 = allData[idx]
      const b1 = allData[idx + 1]
      const b2 = allData[idx + 2]
      socdPairs.push({
        type: b2,
        key1Row: b0 & 0x07,
        key1Col: (b0 >> 3) & 0x1f,
        key2Row: b1 & 0x07,
        key2Col: (b1 >> 3) & 0x1f,
      })
    } else {
      socdPairs.push({
        type: 0 /* SOCD_PRI_NONE */,
        key1Row: 0,
        key1Col: 0,
        key2Row: 0,
        key2Col: 0,
      })
    }
  }

  return socdPairs
}

/** Get the profile name. */
export async function getKeychronAnalogProfileNameStr(
  profile: number,
  rows: number,
  cols: number,
  okmcCount: number,
  socdCount: number,
): Promise<string> {
  const nameOffset = 4 + rows * cols * 4 + okmcCount * 19 + socdCount * 3
  const nameData = await getKeychronAnalogProfileRaw(profile, nameOffset, 30)
  if (!nameData || nameData.length === 0) return ''

  const bytes = new Uint8Array(nameData)
  let nullIdx = bytes.indexOf(0)
  if (nullIdx === -1) nullIdx = bytes.length

  return new TextDecoder().decode(bytes.slice(0, nullIdx))
}

/** Set Toggle advance mode on a key. */
export async function setKeychronAnalogAdvanceModeToggle(
  profile: number,
  row: number,
  col: number,
): Promise<boolean> {
  const resp = await sendReceive(
    cmd(
      KC_ANALOG_MATRIX,
      AMC_SET_ADVANCE_MODE,
      profile,
      ADV_MODE_TOGGLE, // Need to import
      row,
      col,
      0,
    ),
  )
  return resp[0] === KC_ANALOG_MATRIX && resp[1] === AMC_SET_ADVANCE_MODE && resp[2] === KC_SUCCESS
}

// =====================================================================
// Full reload orchestrator
// =====================================================================

/**
 * Reload all Keychron-specific features from the keyboard.
 * Returns null if this is not a Keychron keyboard (protocol check fails).
 *
 * This is the equivalent of vial-gui's ProtocolKeychron.reload_keychron().
 */
export async function reloadKeychron(): Promise<KeychronState | null> {
  // Step 1: Check if this is a Keychron keyboard
  const protocolVersion = await getKeychronProtocolVersion()
  if (protocolVersion < 0) return null

  const state = emptyKeychronState()
  state.protocolVersion = protocolVersion

  // Step 2: Get feature flags
  state.features = await getKeychronSupportFeature()
  if (state.features === 0) return null

  // Step 3: Get firmware version
  state.firmwareVersion = await getKeychronFirmwareVersion()

  // Step 4: Get MCU info
  state.mcuInfo = await getKeychronDfuInfo()

  // Step 5: Get misc protocol version and features
  const misc = await getKeychronMiscProtocol()
  state.miscProtocolVersion = misc.version
  state.miscFeatures = misc.features

  // Compute feature detection flags
  state.hasDebounce =
    !!(state.features & FEATURE_DYNAMIC_DEBOUNCE) || !!(state.miscFeatures & MISC_DEBOUNCE)
  state.hasNkro = !!(state.features & FEATURE_NKRO) || !!(state.miscFeatures & MISC_NKRO)
  state.hasReportRate = !!(state.miscFeatures & MISC_REPORT_RATE)
  state.hasSnapClick =
    !!(state.features & FEATURE_SNAP_CLICK) || !!(state.miscFeatures & MISC_SNAP_CLICK)
  state.hasWireless =
    !!(state.features & (FEATURE_BLUETOOTH | FEATURE_P24G)) ||
    !!(state.miscFeatures & MISC_WIRELESS_LPM)
  state.hasRgb = !!(state.features & FEATURE_KEYCHRON_RGB)
  state.hasAnalog = !!(state.features & FEATURE_ANALOG_MATRIX)
  state.hasDfu = !!(state.miscFeatures & MISC_DFU_INFO) || state.mcuInfo.includes('STM32')
  state.hasDefaultLayer = !!(state.features & FEATURE_DEFAULT_LAYER)

  // Step 6: Load individual features
  if (state.hasDebounce) {
    const deb = await getKeychronDebounce()
    state.debounceType = deb.type
    state.debounceTime = deb.time
  }

  if (state.hasNkro) {
    const nkro = await getKeychronNkro()
    state.nkroEnabled = nkro.enabled
    state.nkroSupported = nkro.supported
    state.nkroAdaptive = nkro.adaptive
  }

  if (state.hasReportRate) {
    const rr = await getKeychronReportRate(state.miscProtocolVersion)
    state.pollRateVersion = rr.pollRateVersion
    state.reportRate = rr.reportRate
    state.reportRateMask = rr.reportRateMask
    state.pollRateUsb = rr.pollRateUsb
    state.pollRateUsbMask = rr.pollRateUsbMask
    state.pollRate24g = rr.pollRate24g
    state.pollRate24gMask = rr.pollRate24gMask
  }

  if (state.hasSnapClick) {
    state.snapClickCount = await getKeychronSnapClickInfo()
    if (state.snapClickCount > 0) {
      state.snapClickEntries = await getKeychronSnapClickEntries(state.snapClickCount)
    }
  }

  if (state.hasDefaultLayer) {
    state.defaultLayer = await getKeychronDefaultLayer()
  }

  if (state.hasWireless) {
    const lpm = await getKeychronWirelessLpm()
    state.wirelessBacklitTime = lpm.backlitTime
    state.wirelessIdleTime = lpm.idleTime
  }
  if (state.hasWireless) {
    const lpm = await getKeychronWirelessLpm()
    state.wirelessBacklitTime = lpm.backlitTime
    state.wirelessIdleTime = lpm.idleTime
  }

  if (state.hasRgb) {
    state.rgb = await reloadKeychronRGB()
  }

  // Debug overrides
  if (process.env.DEBUG_KEYCHRON_ANALOG) {
    state.hasAnalog = true
    state.features |= FEATURE_ANALOG_MATRIX
  }
  if (process.env.DEBUG_KEYCHRON_RGB) {
    state.hasRgb = true
    state.features |= FEATURE_KEYCHRON_RGB
  }
  if (process.env.DEBUG_KEYCHRON_SNAP_CLICK) {
    state.hasSnapClick = true
    state.snapClickCount = 4
    if (state.snapClickEntries.length === 0) {
      state.snapClickEntries = Array(4).fill({ type: 0, key1: 0, key2: 0 })
    }
  }
  if (process.env.DEBUG_KEYCHRON_DEBOUNCE) {
    state.hasDebounce = true
    state.debounceType = 0
    state.debounceTime = 5
  }
  if (process.env.DEBUG_KEYCHRON_NKRO) {
    state.hasNkro = true
    state.nkroSupported = true
    state.nkroEnabled = true
  }
  if (process.env.DEBUG_KEYCHRON_REPORT_RATE) {
    state.hasReportRate = true
    state.reportRate = REPORT_RATE_1000HZ
    state.reportRateMask = 0x7f
  }
  if (process.env.DEBUG_KEYCHRON_WIRELESS) {
    state.hasWireless = true
    state.wirelessBacklitTime = 30
    state.wirelessIdleTime = 300
  }

  if (
    process.env.DEBUG_KEYCHRON_ANALOG ||
    process.env.DEBUG_KEYCHRON_RGB ||
    process.env.DEBUG_KEYCHRON_SNAP_CLICK ||
    process.env.DEBUG_KEYCHRON_DEBOUNCE ||
    process.env.DEBUG_KEYCHRON_NKRO ||
    process.env.DEBUG_KEYCHRON_REPORT_RATE ||
    process.env.DEBUG_KEYCHRON_WIRELESS
  ) {
    state.isDebug = true;
  }

  // Note: Analog Matrix reload is handled separately due to its complexity
  // and will be triggered from the UI when the analog tab is opened.

  return state
}

/**
 * Reload Keychron RGB state.
 * Called as part of reloadKeychron() when RGB features are detected.
 */
async function reloadKeychronRGB(): Promise<KeychronRGBState> {
  const rgb: KeychronRGBState = {
    protocolVersion: 0,
    ledCount: 0,
    perKeyRGBType: PER_KEY_RGB_SOLID,
    perKeyColors: [],
    osIndicatorConfig: null,
    ledMatrix: new Map(),
    mixedRGBLayers: 0,
    mixedRGBEffectsPerLayer: 0,
    mixedRGBRegions: [],
    mixedRGBEffects: [],
  }

  rgb.protocolVersion = await getKeychronRGBProtocolVersion()
  rgb.ledCount = await getKeychronLedCount()
  rgb.osIndicatorConfig = await getKeychronIndicators()
  rgb.perKeyRGBType = await getKeychronPerKeyRGBType()

  if (rgb.ledCount > 0) {
    rgb.ledMatrix = await getKeychronLedMatrix(rgb.ledCount)
    rgb.perKeyColors = await getKeychronPerKeyColors(rgb.ledCount)
  }

  if (process.env.DEBUG_KEYCHRON_RGB || process.env.DEBUG_KEYCHRON_ALL) {
    rgb.isDebug = true
  }

  // Mixed RGB info
  const mixedInfo = await getKeychronMixedRGBInfo()
  rgb.mixedRGBLayers = mixedInfo.layers
  rgb.mixedRGBEffectsPerLayer = mixedInfo.effectsPerLayer

  if (rgb.mixedRGBLayers > 0 && rgb.ledCount > 0) {
    rgb.mixedRGBRegions = await getKeychronMixedRGBRegions(rgb.ledCount)
    for (let region = 0; region < rgb.mixedRGBLayers; region++) {
      rgb.mixedRGBEffects.push(
        await getKeychronMixedRGBEffects(region, rgb.mixedRGBEffectsPerLayer),
      )
    }
  }

  return rgb
}

/**
 * Reload Keychron Analog Matrix state.
 * Due to the size of analog profiles, this should be called separately
 * from the main reloadKeychron(), e.g. when the HE UI tab is opened.
 */
export async function reloadKeychronAnalog(
  rows: number,
  cols: number,
): Promise<KeychronAnalogState | null> {
  // Mock data for testing without HE hardware
  if (process.env.DEBUG_KEYCHRON_ANALOG) {
    const mockProfiles: AnalogProfile[] = []
    for (let p = 0; p < 3; p++) {
      const keyConfigs = new Map<string, AnalogKeyConfig>()
      for (let r = 0; r < Math.min(rows, 6); r++) {
        for (let c = 0; c < Math.min(cols, 16); c++) {
          keyConfigs.set(`${r},${c}`, {
            mode: 0, // AKM_MODE_NORMAL
            actuationPoint: 20, // 2.0mm
            sensitivity: 5, // 0.5mm
            releaseSensitivity: 5,
          })
        }
      }
      const socdPairs: SOCDPair[] = [
        { type: 1, key1Row: 2, key1Col: 1, key2Row: 2, key2Col: 3 }, // A and D
        { type: 2, key1Row: 1, key1Col: 2, key2Row: 3, key2Col: 2 }, // W and S
      ]
      const okmcConfigs: OKMCSlotConfig[] = Array.from({ length: 4 }, () => ({
        shallowAct: 15,
        shallowDeact: 10,
        deepAct: 30,
        deepDeact: 25,
        keycodes: [0x04, 0x05, 0x06, 0x07], // A, B, C, D
        events: [
          OKMC_ACTION_PRESS, OKMC_ACTION_NONE, OKMC_ACTION_NONE, OKMC_ACTION_NONE, // Key 1 Shallow/Deep/DeepRls/ShallowRls
          OKMC_ACTION_NONE, OKMC_ACTION_PRESS, OKMC_ACTION_NONE, OKMC_ACTION_NONE, // Key 2 Shallow/Deep/DeepRls/ShallowRls
          OKMC_ACTION_NONE, OKMC_ACTION_NONE, OKMC_ACTION_RELEASE, OKMC_ACTION_NONE,   // Key 3 Shallow/Deep/DeepRls/ShallowRls
          OKMC_ACTION_NONE, OKMC_ACTION_NONE, OKMC_ACTION_NONE, OKMC_ACTION_RELEASE,   // Key 4 Shallow/Deep/DeepRls/ShallowRls
        ],
      }))
      mockProfiles.push({
        name: `Profile ${p + 1}`,
        keyConfigs,
        socdPairs,
        okmcConfigs,
      })
    }
    return {
      version: 1,
      profileCount: 3,
      currentProfile: 0,
      profileSize: 512,
      socdCount: 8,
      okmcCount: 4,
      profiles: mockProfiles,
      curve: [0, 25, 50, 75, 100],
      gameControllerMode: 0,
      isDebug: true,
    }
  }

  const version = await getKeychronAnalogVersion()
  if (version < 0) return null

  const analog: KeychronAnalogState = {
    version,
    profileCount: 0,
    currentProfile: 0,
    profileSize: 0,
    okmcCount: 0,
    socdCount: 0,
    profiles: [],
    curve: [],
    gameControllerMode: 0,
  }

  const info = await getKeychronAnalogProfilesInfo()
  analog.profileCount = info.profileCount
  analog.currentProfile = info.currentProfile
  analog.profileSize = info.profileSize
  analog.okmcCount = info.okmcCount
  analog.socdCount = info.socdCount

  analog.curve = await getKeychronAnalogCurve()
  analog.gameControllerMode = await getKeychronAnalogGameControllerMode()

  // Load each profile
  for (let i = 0; i < analog.profileCount; i++) {
    const keyConfigs = await getKeychronAnalogKeyConfigs(i, rows, cols)
    const socdPairs = await getKeychronAnalogSocdPairs(
      i,
      rows,
      cols,
      analog.okmcCount,
      analog.socdCount,
    )
    const okmcConfigs = await getKeychronAnalogOkmcConfigs(i, rows, cols, analog.okmcCount)
    const name = await getKeychronAnalogProfileNameStr(
      i,
      rows,
      cols,
      analog.okmcCount,
      analog.socdCount,
    )

    analog.profiles.push({
      name,
      keyConfigs,
      socdPairs,
      okmcConfigs,
    })
  }

  return analog
}

// =====================================================================
// Keychron Bootloader Jump (proprietary protocol)
// =====================================================================

/**
 * Keychron-proprietary bootloader jump using KC_MISC_CMD_GROUP + BOOTLOADER_JUMP (0x15).
 *
 * Reverse-engineered from the Keychron Launcher source.
 * The keyboard implements a state machine:
 *   BL_IDLE(0) → BL_WAITING(1) → BL_HOLDING(2) → BL_AWAIT_CONFIRM(3) → BL_CONFIRMED(4)
 *
 * The host sends [0xA7, 0x15], then polls the response. When the keyboard reaches
 * BL_AWAIT_CONFIRM, the host sends [0xA7, 0x15] again to confirm the jump.
 * The keyboard then reboots into the DFU bootloader.
 *
 * @param onState - Optional callback that receives each state update for UI feedback
 * @param timeoutMs - Maximum time to wait for BL_CONFIRMED (default 60s)
 * @returns The final bootloader state
 */
export async function keychronJumpBootloader(
  onState?: (state: number) => void,
  timeoutMs = 60_000,
): Promise<number> {
  const pkt = new Uint8Array(MSG_LEN)
  pkt[0] = KC_MISC_CMD_GROUP
  pkt[1] = BOOTLOADER_JUMP

  // Initial request — kicks off the state machine
  const firstResp = await sendReceive(pkt)
  const firstState = firstResp[3]
  onState?.(firstState)

  // If keyboard immediately confirmed (unlikely but handle it)
  if (firstState === BL_CONFIRMED) return BL_CONFIRMED
  if (firstState === BL_TIMEOUT || firstState === BL_EXCEEDED) return firstState

  // Poll the state machine until confirmed, timed out, or exceeded
  const deadline = Date.now() + timeoutMs
  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  while (Date.now() < deadline) {
    await delay(200)

    const resp = await sendReceive(pkt)
    const state = resp[3]
    onState?.(state)

    if (state === BL_AWAIT_CONFIRM) {
      // Confirm the jump — send the same packet again
      // After this the keyboard reboots and the HID connection drops.
      // Use a try/catch because the device will disconnect mid-response.
      try {
        await sendReceive(pkt)
      } catch {
        // Expected — device disconnected during reboot
      }
      return BL_CONFIRMED
    }

    if (state === BL_CONFIRMED) return BL_CONFIRMED
    if (state === BL_TIMEOUT) return BL_TIMEOUT
    if (state === BL_EXCEEDED) return BL_EXCEEDED
  }

  return BL_TIMEOUT
}
