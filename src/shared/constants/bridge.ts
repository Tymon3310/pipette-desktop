// Keychron 2.4 GHz Bridge / Forza Receiver protocol constants
// Ported from vial-gui protocol/bridge.py

// ── FR Command IDs ──────────────────────────────────────────────────
export const FR_GET_PROTOCOL_VERSION = 0xb1
export const FR_GET_STATE = 0xb2
export const FR_GET_FW_VERSION = 0xb3
export const FR_CTL_GAMEPAD_RPT_ENABLE = 0xb5
export const FR_DFU_OVER_VIA = 0xba

// ── State notification markers ─────────────────────────────────────
export const FR_STATE_NOTIFY = 0xbc
export const FR_STATE_NOTIFY_ALT = 0xe2

// ── Bridge HID interface (used for detection only) ─────────────────
export const BRIDGE_USAGE_PAGE = 0x8c // 140 decimal
export const BRIDGE_USAGE = 0x01

// ── Feature flags (from FR_GET_PROTOCOL_VERSION response byte 3) ───
export const BRIDGE_FEAT_STATE_NOTIFY_OVER_VIA = 0x80 // bit 7
export const BRIDGE_FEAT_MULTI_DEVICE_CONNECT = 0x40 // bit 6
export const BRIDGE_FEAT_MOUSE_DRIVER_OVER_VIA = 0x20 // bit 5
export const BRIDGE_FEAT_VIA_DISABLE_GAMEPAD_INPUT = 0x10 // bit 4

// ── Connection modes ───────────────────────────────────────────────
export const CONNECTION_MODE_24G = 0
export const CONNECTION_MODE_BT = 1
export const CONNECTION_MODE_USB = 2

export const CONNECTION_MODE_NAMES: Record<number, string> = {
  [CONNECTION_MODE_24G]: '2.4 GHz',
  [CONNECTION_MODE_BT]: 'Bluetooth',
  [CONNECTION_MODE_USB]: 'USB',
}

// ── XOR encoding key ───────────────────────────────────────────────
// The LKBT51 wireless module crashes on certain byte values (e.g. 0xFE).
// XOR-encoding all bytes avoids the problematic values.
export const WIRELESS_RAW_HID_XOR_KEY = 0x28
