// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Keychron-specific types for protocol state and UI.
 */

/** A single Snap Click (SOCD) entry. */
export interface SnapClickEntry {
  type: number
  key1: number
  key2: number
}

/** OS indicator configuration. */
export interface OsIndicatorConfig {
  availableMask: number
  disableMask: number
  hue: number
  sat: number
  val: number
}

/** A single Mixed RGB effect entry (8 bytes on wire). */
export interface MixedRGBEffect {
  effect: number
  hue: number
  sat: number
  speed: number
  time: number // display duration in ms (LE32 on wire)
}

/** Per-key RGB state. */
export interface KeychronRGBState {
  protocolVersion: number
  ledCount: number
  perKeyRGBType: number
  perKeyColors: [number, number, number][] // [H, S, V] tuples
  osIndicatorConfig: OsIndicatorConfig | null
  ledMatrix: Map<string, number> // "row,col" -> LED index

  // Mixed RGB
  mixedRGBLayers: number
  mixedRGBEffectsPerLayer: number
  mixedRGBRegions: number[]
  mixedRGBEffects: MixedRGBEffect[][]
}

/** Analog key configuration for a single key. */
export interface AnalogKeyConfig {
  mode: number
  actuationPoint: number
  sensitivity: number
  releaseSensitivity: number
}

/** SOCD pair for HE keyboards. */
export interface SOCDPair {
  type: number
  key1Row: number
  key1Col: number
  key2Row: number
  key2Col: number
}

/** OKMC (DKS) slot configuration. */
export interface OKMCSlotConfig {
  shallowAct: number
  shallowDeact: number
  deepAct: number
  deepDeact: number
  keycodes: number[]
  events: number[] // 4 nibble-pairs per event slot
}

/** Analog profile. */
export interface AnalogProfile {
  name: string
  keyConfigs: Map<string, AnalogKeyConfig> // "row,col" -> config
  socdPairs: SOCDPair[]
  okmcConfigs: OKMCSlotConfig[]
}

/** Complete Analog Matrix state. */
export interface KeychronAnalogState {
  version: number
  profileCount: number
  currentProfile: number
  profileSize: number
  okmcCount: number
  socdCount: number
  profiles: AnalogProfile[]
  curve: number[]
  gameControllerMode: number
}

/** Complete Keychron keyboard state - returned by reloadKeychron(). */
export interface KeychronState {
  // Protocol info
  protocolVersion: number
  firmwareVersion: string
  mcuInfo: string

  // Feature flags (from KC_GET_SUPPORT_FEATURE + MISC_GET_PROTOCOL_VER)
  features: number
  miscFeatures: number
  miscProtocolVersion: number

  // Debounce
  debounceType: number
  debounceTime: number

  // NKRO
  nkroEnabled: boolean
  nkroSupported: boolean
  nkroAdaptive: boolean

  // Report rate (v1 = single, v2 = dual USB / 2.4 GHz)
  pollRateVersion: number
  reportRate: number
  reportRateMask: number
  pollRateUsb: number
  pollRateUsbMask: number
  pollRate24g: number
  pollRate24gMask: number

  // Snap Click (SOCD for regular keyboards)
  snapClickCount: number
  snapClickEntries: SnapClickEntry[]

  // Wireless LPM
  wirelessBacklitTime: number
  wirelessIdleTime: number

  // Feature detection helpers (computed from flags)
  hasDebounce: boolean
  hasNkro: boolean
  hasReportRate: boolean
  hasSnapClick: boolean
  hasWireless: boolean
  hasRgb: boolean
  hasAnalog: boolean
  hasDfu: boolean
  hasDefaultLayer: boolean
  defaultLayer: number

  // RGB state (populated when hasRgb is true)
  rgb: KeychronRGBState | null

  // Analog Matrix state (populated when hasAnalog is true)
  analog: KeychronAnalogState | null
}

/** Create the default empty KeychronState. */
export function emptyKeychronState(): KeychronState {
  return {
    protocolVersion: 0,
    firmwareVersion: '',
    mcuInfo: '',
    features: 0,
    miscFeatures: 0,
    miscProtocolVersion: 0,
    debounceType: 0,
    debounceTime: 5,
    nkroEnabled: false,
    nkroSupported: false,
    nkroAdaptive: false,
    pollRateVersion: 1,
    reportRate: 3, // REPORT_RATE_1000HZ
    reportRateMask: 0x7f,
    pollRateUsb: 3,
    pollRateUsbMask: 0x7f,
    pollRate24g: 3,
    pollRate24gMask: 0x7f,
    snapClickCount: 0,
    snapClickEntries: [],
    wirelessBacklitTime: 30,
    wirelessIdleTime: 300,
    hasDebounce: false,
    hasNkro: false,
    hasReportRate: false,
    hasSnapClick: false,
    hasWireless: false,
    hasRgb: false,
    hasAnalog: false,
    hasDfu: false,
    hasDefaultLayer: false,
    defaultLayer: -1,
    rgb: null,
    analog: null,
  }
}
