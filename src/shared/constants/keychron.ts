// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Keychron-specific HID protocol constants.
 *
 * Ported from vial-gui keychron.py — command IDs, sub-commands, feature flags,
 * enums, and lookup maps for the Keychron raw HID protocol.
 *
 * All Keychron commands are 32-byte HID reports on Usage Page 0xFF60, Usage 0x61.
 * The first byte (data[0]) is the command ID.
 */

// =====================================================================
// Main command IDs (data[0])
// =====================================================================
export const KC_GET_PROTOCOL_VERSION = 0xa0
export const KC_GET_FIRMWARE_VERSION = 0xa1
export const KC_GET_SUPPORT_FEATURE = 0xa2
export const KC_GET_DEFAULT_LAYER = 0xa3
export const KC_MISC_CMD_GROUP = 0xa7
export const KC_KEYCHRON_RGB = 0xa8
export const KC_ANALOG_MATRIX = 0xa9
export const KC_WIRELESS_DFU = 0xaa
export const KC_FACTORY_TEST = 0xab

// =====================================================================
// Feature flags (from KC_GET_SUPPORT_FEATURE)
// =====================================================================
// Byte 0 flags
export const FEATURE_DEFAULT_LAYER = 0x01
export const FEATURE_BLUETOOTH = 0x02
export const FEATURE_P24G = 0x04
export const FEATURE_ANALOG_MATRIX = 0x08
export const FEATURE_STATE_NOTIFY = 0x10
export const FEATURE_DYNAMIC_DEBOUNCE = 0x20
export const FEATURE_SNAP_CLICK = 0x40
export const FEATURE_KEYCHRON_RGB = 0x80
// Byte 1 flags (shifted by 8)
export const FEATURE_QUICK_START = 0x0100
export const FEATURE_NKRO = 0x0200

// =====================================================================
// Misc command group sub-commands (data[1] when data[0] = 0xA7)
// =====================================================================
export const MISC_GET_PROTOCOL_VER = 0x01
export const DFU_INFO_GET = 0x02
export const LANGUAGE_GET = 0x03
export const LANGUAGE_SET = 0x04
export const DEBOUNCE_GET = 0x05
export const DEBOUNCE_SET = 0x06
export const SNAP_CLICK_GET_INFO = 0x07
export const SNAP_CLICK_GET = 0x08
export const SNAP_CLICK_SET = 0x09
export const SNAP_CLICK_SAVE = 0x0a
export const WIRELESS_LPM_GET = 0x0b
export const WIRELESS_LPM_SET = 0x0c
export const REPORT_RATE_GET = 0x0d
export const REPORT_RATE_SET = 0x0e
export const DIP_SWITCH_GET = 0x0f
export const DIP_SWITCH_SET = 0x10
export const FACTORY_RESET = 0x11
export const NKRO_GET = 0x12
export const NKRO_SET = 0x13
// Keychron-proprietary bootloader jump (sub-command 21 = 0x15)
// Discovered from Keychron Launcher source — NOT the standard VIA 0x0B command.
// Uses a state machine: BL_IDLE→BL_WAITING→BL_HOLDING→BL_AWAIT_CONFIRM→BL_CONFIRMED
export const BOOTLOADER_JUMP = 0x15

// Bootloader jump state machine states
export const BL_IDLE = 0
export const BL_WAITING = 1
export const BL_HOLDING = 2
export const BL_AWAIT_CONFIRM = 3
export const BL_CONFIRMED = 4
export const BL_TIMEOUT = 5
export const BL_EXCEEDED = 6

// =====================================================================
// Misc feature support flags (from MISC_GET_PROTOCOL_VER response)
// =====================================================================
export const MISC_DFU_INFO = 0x01
export const MISC_LANGUAGE = 0x02
export const MISC_DEBOUNCE = 0x04
export const MISC_SNAP_CLICK = 0x08
export const MISC_WIRELESS_LPM = 0x10
export const MISC_REPORT_RATE = 0x20
export const MISC_QUICK_START = 0x40
export const MISC_NKRO = 0x80

// =====================================================================
// Debounce types
// =====================================================================
export const DEBOUNCE_SYM_DEFER_GLOBAL = 0
export const DEBOUNCE_SYM_DEFER_PER_ROW = 1
export const DEBOUNCE_SYM_DEFER_PER_KEY = 2
export const DEBOUNCE_SYM_EAGER_PER_ROW = 3
export const DEBOUNCE_SYM_EAGER_PER_KEY = 4
export const DEBOUNCE_ASYM_EAGER_DEFER_PER_KEY = 5
export const DEBOUNCE_NONE = 6

export const DEBOUNCE_TYPE_NAMES: Record<number, string> = {
  [DEBOUNCE_SYM_DEFER_GLOBAL]: 'Symmetric Defer (Global)',
  [DEBOUNCE_SYM_DEFER_PER_ROW]: 'Symmetric Defer (Per Row)',
  [DEBOUNCE_SYM_DEFER_PER_KEY]: 'Symmetric Defer (Per Key)',
  [DEBOUNCE_SYM_EAGER_PER_ROW]: 'Symmetric Eager (Per Row)',
  [DEBOUNCE_SYM_EAGER_PER_KEY]: 'Symmetric Eager (Per Key)',
  [DEBOUNCE_ASYM_EAGER_DEFER_PER_KEY]: 'Asymmetric Eager-Defer (Per Key)',
  [DEBOUNCE_NONE]: 'None',
}

// =====================================================================
// Snap Click types (SOCD for regular keyboards)
// =====================================================================
export const SNAP_CLICK_TYPE_NONE = 0
export const SNAP_CLICK_TYPE_REGULAR = 1
export const SNAP_CLICK_TYPE_LAST_INPUT = 2
export const SNAP_CLICK_TYPE_FIRST_KEY = 3
export const SNAP_CLICK_TYPE_SECOND_KEY = 4
export const SNAP_CLICK_TYPE_NEUTRAL = 5

export const SNAP_CLICK_TYPE_NAMES: Record<number, string> = {
  [SNAP_CLICK_TYPE_NONE]: 'Disabled',
  [SNAP_CLICK_TYPE_REGULAR]: 'Last Key Priority (simple)',
  [SNAP_CLICK_TYPE_LAST_INPUT]: 'Last Key Priority (re-activates held key)',
  [SNAP_CLICK_TYPE_FIRST_KEY]: 'Absolute Priority: Key 1',
  [SNAP_CLICK_TYPE_SECOND_KEY]: 'Absolute Priority: Key 2',
  [SNAP_CLICK_TYPE_NEUTRAL]: 'Cancel (both keys cancel out)',
}

export const SNAP_CLICK_TYPE_TOOLTIPS: Record<number, string> = {
  [SNAP_CLICK_TYPE_NONE]: 'This pair is inactive.',
  [SNAP_CLICK_TYPE_REGULAR]:
    'When both keys are pressed, the most recently pressed key wins. Releasing either key unregisters only that key.',
  [SNAP_CLICK_TYPE_LAST_INPUT]:
    'When both keys are pressed, the most recently pressed key wins. Releasing the winning key re-activates the still-held losing key.',
  [SNAP_CLICK_TYPE_FIRST_KEY]:
    'Key 1 always takes priority when both are pressed. Releasing Key 1 re-activates Key 2 if still held.',
  [SNAP_CLICK_TYPE_SECOND_KEY]:
    'Key 2 always takes priority when both are pressed. Releasing Key 2 re-activates Key 1 if still held.',
  [SNAP_CLICK_TYPE_NEUTRAL]:
    'When both keys are pressed simultaneously, neither key registers. Releasing one key re-activates the other.',
}

// =====================================================================
// USB Report Rate dividers
// =====================================================================
export const REPORT_RATE_8000HZ = 0
export const REPORT_RATE_4000HZ = 1
export const REPORT_RATE_2000HZ = 2
export const REPORT_RATE_1000HZ = 3
export const REPORT_RATE_500HZ = 4
export const REPORT_RATE_250HZ = 5
export const REPORT_RATE_125HZ = 6

export const REPORT_RATE_NAMES: Record<number, string> = {
  [REPORT_RATE_8000HZ]: '8000 Hz',
  [REPORT_RATE_4000HZ]: '4000 Hz',
  [REPORT_RATE_2000HZ]: '2000 Hz',
  [REPORT_RATE_1000HZ]: '1000 Hz',
  [REPORT_RATE_500HZ]: '500 Hz',
  [REPORT_RATE_250HZ]: '250 Hz',
  [REPORT_RATE_125HZ]: '125 Hz',
}

// =====================================================================
// RGB sub-commands (data[1] when data[0] = 0xA8)
// =====================================================================
export const RGB_GET_PROTOCOL_VER = 0x01
export const RGB_SAVE = 0x02
export const GET_INDICATORS_CONFIG = 0x03
export const SET_INDICATORS_CONFIG = 0x04
export const RGB_GET_LED_COUNT = 0x05
export const RGB_GET_LED_IDX = 0x06
export const PER_KEY_RGB_GET_TYPE = 0x07
export const PER_KEY_RGB_SET_TYPE = 0x08
export const PER_KEY_RGB_GET_COLOR = 0x09
export const PER_KEY_RGB_SET_COLOR = 0x0a
export const MIXED_EFFECT_RGB_GET_INFO = 0x0b
export const MIXED_EFFECT_RGB_GET_REGIONS = 0x0c
export const MIXED_EFFECT_RGB_SET_REGIONS = 0x0d
export const MIXED_EFFECT_RGB_GET_EFFECT_LIST = 0x0e
export const MIXED_EFFECT_RGB_SET_EFFECT_LIST = 0x0f

// Per-key RGB effect types
export const PER_KEY_RGB_SOLID = 0
export const PER_KEY_RGB_BREATHING = 1
export const PER_KEY_RGB_REACTIVE_SIMPLE = 2
export const PER_KEY_RGB_REACTIVE_MULTI_WIDE = 3
export const PER_KEY_RGB_REACTIVE_SPLASH = 4

export const PER_KEY_RGB_TYPE_NAMES: Record<number, string> = {
  [PER_KEY_RGB_SOLID]: 'Solid',
  [PER_KEY_RGB_BREATHING]: 'Breathing',
  [PER_KEY_RGB_REACTIVE_SIMPLE]: 'Reactive Simple',
  [PER_KEY_RGB_REACTIVE_MULTI_WIDE]: 'Reactive Multi Wide',
  [PER_KEY_RGB_REACTIVE_SPLASH]: 'Reactive Splash',
}

// =====================================================================
// Analog Matrix sub-commands (data[1] when data[0] = 0xA9)
// =====================================================================
export const AMC_GET_VERSION = 0x01
export const AMC_GET_PROFILES_INFO = 0x10
export const AMC_SELECT_PROFILE = 0x11
export const AMC_GET_PROFILE_RAW = 0x12
export const AMC_SET_PROFILE_NAME = 0x13
export const AMC_SET_TRAVEL = 0x14
export const AMC_SET_ADVANCE_MODE = 0x15
export const AMC_SET_SOCD = 0x16
export const AMC_RESET_PROFILE = 0x1e
export const AMC_SAVE_PROFILE = 0x1f
export const AMC_GET_CURVE = 0x20
export const AMC_SET_CURVE = 0x21
export const AMC_GET_GAME_CONTROLLER_MODE = 0x22
export const AMC_SET_GAME_CONTROLLER_MODE = 0x23
export const AMC_GET_REALTIME_TRAVEL = 0x30
export const AMC_CALIBRATE = 0x40
export const AMC_GET_CALIBRATE_STATE = 0x41
export const AMC_GET_CALIBRATED_VALUE = 0x42

// Analog key modes
export const AKM_GLOBAL = 0
export const AKM_REGULAR = 1
export const AKM_RAPID = 2
export const AKM_DKS = 3
export const AKM_GAMEPAD = 4
export const AKM_TOGGLE = 5

export const AKM_MODE_NAMES: Record<number, string> = {
  [AKM_GLOBAL]: 'Global',
  [AKM_REGULAR]: 'Regular',
  [AKM_RAPID]: 'Rapid Trigger',
  [AKM_DKS]: 'Dynamic Keystroke',
  [AKM_GAMEPAD]: 'Gamepad',
  [AKM_TOGGLE]: 'Toggle',
}

// Advance mode types
export const ADV_MODE_CLEAR = 0
export const ADV_MODE_OKMC = 1
export const ADV_MODE_GAME_CONTROLLER = 2
export const ADV_MODE_TOGGLE = 3

// SOCD prioritization types (for HE keyboards)
export const SOCD_PRI_NONE = 0
export const SOCD_PRI_DEEPER_TRAVEL = 1
export const SOCD_PRI_DEEPER_TRAVEL_SINGLE = 2
export const SOCD_PRI_LAST_KEYSTROKE = 3
export const SOCD_PRI_KEY_1 = 4
export const SOCD_PRI_KEY_2 = 5
export const SOCD_PRI_NEUTRAL = 6

export const SOCD_TYPE_NAMES: Record<number, string> = {
  [SOCD_PRI_NONE]: 'Disabled',
  [SOCD_PRI_DEEPER_TRAVEL]: 'Deeper Travel',
  [SOCD_PRI_DEEPER_TRAVEL_SINGLE]: 'Deeper Travel (Single)',
  [SOCD_PRI_LAST_KEYSTROKE]: 'Last Keystroke',
  [SOCD_PRI_KEY_1]: 'Key 1 Priority',
  [SOCD_PRI_KEY_2]: 'Key 2 Priority',
  [SOCD_PRI_NEUTRAL]: 'Neutral',
}

// Calibration states
export const CALIB_OFF = 0
export const CALIB_ZERO_TRAVEL_POWER_ON = 1
export const CALIB_ZERO_TRAVEL_MANUAL = 2
export const CALIB_FULL_TRAVEL_MANUAL = 3
export const CALIB_SAVE_AND_EXIT = 4
export const CALIB_CLEAR = 5

// OKMC (DKS) action bitfield values
export const OKMC_ACTION_NONE = 0b000
export const OKMC_ACTION_RELEASE = 0b001
export const OKMC_ACTION_PRESS = 0b010
export const OKMC_ACTION_TAP = 0b110
export const OKMC_ACTION_RE_PRESS = 0b111

export const OKMC_ACTION_NAMES: Record<number, string> = {
  [OKMC_ACTION_NONE]: 'None',
  [OKMC_ACTION_RELEASE]: 'Release',
  [OKMC_ACTION_PRESS]: 'Press',
  [OKMC_ACTION_TAP]: 'Tap',
  [OKMC_ACTION_RE_PRESS]: 'Re-press',
}

// Gamepad axis/direction and button assignments
export const GC_X_AXIS_LEFT = 0
export const GC_X_AXIS_RIGHT = 1
export const GC_Y_AXIS_DOWN = 2
export const GC_Y_AXIS_UP = 3
export const GC_Z_AXIS_N = 4
export const GC_Z_AXIS_P = 5
export const GC_RX_AXIS_LEFT = 6
export const GC_RX_AXIS_RIGHT = 7
export const GC_RY_AXIS_DOWN = 8
export const GC_RY_AXIS_UP = 9
export const GC_RZ_AXIS_N = 10
export const GC_RZ_AXIS_P = 11
export const GC_AXIS_MAX = 12

export const GC_AXIS_NAMES: Record<number, string> = {
  [GC_X_AXIS_LEFT]: 'X- (Left)',
  [GC_X_AXIS_RIGHT]: 'X+ (Right)',
  [GC_Y_AXIS_DOWN]: 'Y- (Down)',
  [GC_Y_AXIS_UP]: 'Y+ (Up)',
  [GC_Z_AXIS_N]: 'Z-',
  [GC_Z_AXIS_P]: 'Z+',
  [GC_RX_AXIS_LEFT]: 'RX- (Left)',
  [GC_RX_AXIS_RIGHT]: 'RX+ (Right)',
  [GC_RY_AXIS_DOWN]: 'RY- (Down)',
  [GC_RY_AXIS_UP]: 'RY+ (Up)',
  [GC_RZ_AXIS_N]: 'RZ-',
  [GC_RZ_AXIS_P]: 'RZ+',
  // Buttons 0-31 (indices GC_AXIS_MAX+1 .. GC_AXIS_MAX+32)
  ...Object.fromEntries(Array.from({ length: 32 }, (_, i) => [GC_AXIS_MAX + 1 + i, `Button ${i}`])),
}

export const GC_MASK_XINPUT = 0x01
export const GC_MASK_TYPING = 0x02

// Response status codes
export const KC_SUCCESS = 0
export const KC_FAIL = 1

// Keychron vendor ID
export const KEYCHRON_VENDOR_ID = 0x3434
