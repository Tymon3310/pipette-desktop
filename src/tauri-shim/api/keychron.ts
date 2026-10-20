// SPDX-License-Identifier: GPL-2.0-or-later
// The VialAPI Keychron members: the Keychron protocol (../keychron-protocol.ts)
// over the same transport as the Vial protocol, and the DFU flasher, which
// runs dfu-util in the backend (src-tauri/src/keychron_dfu.rs) and reports
// its output on IpcChannels.KEYCHRON_DFU_OUTPUT.

import * as keychron from '../keychron-protocol'
import * as protocol from '../protocol'
import { IpcChannels } from '../../shared/ipc/channels'
import type { VialAPI } from '../../shared/types/vial-api'
import { call, subscribe } from '../ipc'

export interface KeychronDfuOutput {
  log?: string
  progress?: number
}

export interface KeychronDfuResult {
  success: boolean
  error?: string
}

export const keychronApi = {
  keychronReload: () => keychron.reloadKeychron(),
  keychronSetDebounce: (type, time) => keychron.setKeychronDebounce(type, time),
  keychronSetNkro: (enabled) => keychron.setKeychronNkro(enabled),
  keychronSetReportRate: (rate) => keychron.setKeychronReportRate(rate),
  keychronSetPollRateV2: (usbRate, frRate) => keychron.setKeychronPollRateV2(usbRate, frRate),
  keychronSetWirelessLpm: (backlitTime, idleTime) => keychron.setKeychronWirelessLpm(backlitTime, idleTime),
  keychronSetSnapClick: (index, snapType, key1, key2) =>
    keychron.setKeychronSnapClick(index, snapType, key1, key2),
  keychronSaveSnapClick: () => keychron.saveKeychronSnapClick(),
  keychronSetPerKeyRGBType: (effectType) => keychron.setKeychronPerKeyRGBType(effectType),
  keychronSetPerKeyColor: (ledIndex, h, s, v) => keychron.setKeychronPerKeyColor(ledIndex, h, s, v),
  keychronSaveRGB: () => keychron.saveKeychronRGB(),
  keychronSetIndicators: (disableMask, hue, sat, val) => keychron.setKeychronIndicators(disableMask, hue, sat, val),
  keychronSetMixedRGBRegions: (startIndex, regions) => keychron.setKeychronMixedRGBRegions(startIndex, regions),
  keychronSetMixedRGBEffects: (regionIndex, startIndex, effects) =>
    keychron.setKeychronMixedRGBEffects(regionIndex, startIndex, effects),
  keychronAnalogReload: (rows, cols) => keychron.reloadKeychronAnalog(rows, cols),
  keychronAnalogGetVersion: () => keychron.getKeychronAnalogVersion(),
  keychronAnalogGetProfilesInfo: () => keychron.getKeychronAnalogProfilesInfo(),
  keychronAnalogGetCurve: () => keychron.getKeychronAnalogCurve(),
  keychronAnalogSetCurve: (curvePoints) => keychron.setKeychronAnalogCurve(curvePoints),
  keychronAnalogGetGameControllerMode: () => keychron.getKeychronAnalogGameControllerMode(),
  keychronAnalogSetProfile: (profileIndex) => keychron.setKeychronAnalogProfile(profileIndex),
  keychronAnalogSetTravel: (profile, mode, actPt, sens, rlsSens, entire, rowMask) =>
    keychron.setKeychronAnalogTravel(profile, mode, actPt, sens, rlsSens, entire, rowMask),
  keychronAnalogSetSocd: (profile, row1, col1, row2, col2, index, socdType) =>
    keychron.setKeychronAnalogSocd(profile, row1, col1, row2, col2, index, socdType),
  keychronAnalogSaveProfile: (profile) => keychron.saveKeychronAnalogProfile(profile),
  keychronAnalogResetProfile: (profile) => keychron.resetKeychronAnalogProfile(profile),
  keychronAnalogSetGameControllerMode: (mode) => keychron.setKeychronAnalogGameControllerMode(mode),
  keychronAnalogGetProfileRaw: (profile, offset, size) => keychron.getKeychronAnalogProfileRaw(profile, offset, size),
  keychronAnalogStartCalibration: (calibType) => keychron.startKeychronCalibration(calibType),
  keychronAnalogGetCalibrationState: () => keychron.getKeychronCalibrationState(),
  keychronAnalogGetRealtimeTravel: (row, col) => keychron.getKeychronRealtimeTravel(row, col),
  keychronAnalogSetProfileName: (profile, name) => keychron.setKeychronAnalogProfileName(profile, name),
  keychronAnalogSetAdvanceModeClear: (profile, row, col) =>
    keychron.setKeychronAnalogAdvanceModeClear(profile, row, col),
  keychronAnalogSetAdvanceModeDks: (
    profile,
    row,
    col,
    okmcIndex,
    shallowAct,
    shallowDeact,
    deepAct,
    deepDeact,
    keycodes,
    actions,
  ) =>
    keychron.setKeychronAnalogAdvanceModeDks(
      profile,
      row,
      col,
      okmcIndex,
      shallowAct,
      shallowDeact,
      deepAct,
      deepDeact,
      keycodes,
      actions,
    ),
  keychronAnalogSetAdvanceModeToggle: (profile, row, col) =>
    keychron.setKeychronAnalogAdvanceModeToggle(profile, row, col),

  // --- DFU flasher ---
  keychronDfuFlash: (firmwareData) =>
    call<KeychronDfuResult>('keychron_dfu_flash', { data: Array.from(new Uint8Array(firmwareData)) }),
  keychronDfuOnOutput: (callback) => subscribe<KeychronDfuOutput>(IpcChannels.KEYCHRON_DFU_OUTPUT, callback),

  // --- Special commands ---
  jumpToBootloader: () => protocol.resetDevice(),
} satisfies Partial<VialAPI>
