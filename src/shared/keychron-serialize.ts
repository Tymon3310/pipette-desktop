/**
 * Keychron settings serialisation / deserialisation.
 *
 * Output format is 100 % compatible with vial-gui's layout files so `.vil`
 * files are interchangeable between Pipette and vial-gui.
 *
 * All keys use snake_case to match vial-gui's Python naming convention.
 */

import type { KeychronState } from '../shared/types/keychron'

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Read a value with fallback key (legacy camelCase → new snake_case) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: any, snakeKey: string, camelKey: string): unknown {
  return obj[snakeKey] ?? obj[camelKey]
}

/* ------------------------------------------------------------------ */
/* Serialise (save)                                                   */
/* ------------------------------------------------------------------ */

export interface VialRGBSnapshot {
  mode: number
  speed: number
  hue: number
  sat: number
  val: number
}

export function serializeKeychronState(
  state: KeychronState | null,
  vialRgb?: VialRGBSnapshot | null,
): Record<string, unknown> | undefined {
  if (!state) return undefined
  const data: Record<string, unknown> = {}

  if (state.hasDebounce) {
    data.debounce = { type: state.debounceType, time: state.debounceTime }
  }
  if (state.hasNkro && !state.nkroAdaptive) {
    data.nkro = { enabled: state.nkroEnabled }
  }
  if (state.hasReportRate) {
    if (state.pollRateVersion === 2) {
      data.report_rate_v2 = { usb: state.pollRateUsb, fr: state.pollRate24g }
    } else {
      data.report_rate = state.reportRate
    }
  }
  if (state.hasWireless) {
    data.wireless_lpm = {
      backlit_time: state.wirelessBacklitTime,
      idle_time: state.wirelessIdleTime,
    }
  }
  if (state.hasSnapClick && state.snapClickCount > 0) {
    data.snap_click = state.snapClickEntries.map((e) => ({
      type: e.type,
      key1: e.key1,
      key2: e.key2,
    }))
  }

  if (state.hasRgb && state.rgb) {
    const rgb = state.rgb
    const rgbData: Record<string, unknown> = {}

    // VialRGB global effect — same keys as vial-gui
    if (vialRgb) {
      rgbData.vialrgb_mode = vialRgb.mode
      rgbData.vialrgb_speed = vialRgb.speed
      rgbData.vialrgb_hsv = [vialRgb.hue, vialRgb.sat, vialRgb.val]
    }

    rgbData.per_key_rgb_type = rgb.perKeyRGBType
    rgbData.per_key_colors = rgb.perKeyColors

    if (rgb.osIndicatorConfig) {
      rgbData.os_indicator = {
        disable_mask: rgb.osIndicatorConfig.disableMask,
        hue: rgb.osIndicatorConfig.hue,
        sat: rgb.osIndicatorConfig.sat,
        val: rgb.osIndicatorConfig.val,
      }
    }
    if (rgb.mixedRGBLayers > 0) {
      rgbData.mixed_rgb_regions = rgb.mixedRGBRegions
      rgbData.mixed_rgb_effects = rgb.mixedRGBEffects.map((layer) =>
        layer.map((e) => [e.effect, e.hue, e.sat, e.speed, e.time]),
      )
    }
    data.rgb = rgbData
  }

  if (state.hasAnalog && state.analog && state.analog.profileCount > 0) {
    const analog = state.analog
    const analogData: Record<string, unknown> = {
      current_profile: analog.currentProfile,
      curve: analog.curve,
      game_controller_mode: analog.gameControllerMode,
      profiles: analog.profiles.map((p) => {
        // Key configs — vial-gui uses "r,c" keys and snake_case values
        const key_configs: Record<string, unknown> = {}
        p.keyConfigs.forEach((cfg, key) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = cfg as any
          key_configs[key] = {
            mode: cfg.mode,
            actuation_point: cfg.actuationPoint,
            sensitivity: cfg.sensitivity,
            release_sensitivity: cfg.releaseSensitivity,
            adv_mode: raw.advMode ?? 0,
            adv_mode_data: raw.advModeData ?? 0,
          }
        })
        return {
          name: p.name,
          key_configs,
          // SOCD pairs — vial-gui uses row1/col1/row2/col2
          socd_pairs: p.socdPairs.map((s) => ({
            type: s.type,
            row1: s.key1Row,
            col1: s.key1Col,
            row2: s.key2Row,
            col2: s.key2Col,
          })),
          // OKMC/DKS configs — vial-gui uses snake_case
          okmc_configs: p.okmcConfigs.map((o) => ({
            shallow_act: o.shallowAct,
            shallow_deact: o.shallowDeact,
            deep_act: o.deepAct,
            deep_deact: o.deepDeact,
            keycodes: o.keycodes,
            actions: o.events,
          })),
        }
      }),
    }
    data.analog = analogData
  }
  return Object.keys(data).length > 0 ? data : undefined
}

/* ------------------------------------------------------------------ */
/* Deserialise (restore)                                              */
/* ------------------------------------------------------------------ */

/** Subset of the vialAPI needed for Keychron settings restore. */
export interface KeychronRestoreAPI {
  keychronSetDebounce(type: number, time: number): Promise<boolean>
  keychronSetNkro(enabled: boolean): Promise<boolean>
  keychronSetReportRate(rate: number): Promise<boolean>
  keychronSetPollRateV2(usbRate: number, frRate: number): Promise<boolean>
  keychronSetWirelessLpm(backlitTime: number, idleTime: number): Promise<boolean>
  keychronSetSnapClick(index: number, snapType: number, key1: number, key2: number): Promise<boolean>
  keychronSaveSnapClick(): Promise<boolean>
  keychronSetPerKeyRGBType(effectType: number): Promise<void>
  keychronSetPerKeyColor(ledIndex: number, h: number, s: number, v: number): Promise<void>
  keychronSetIndicators(disableMask: number, hue: number, sat: number, val: number): Promise<void>
  keychronSetMixedRGBRegions(startIndex: number, regions: number[]): Promise<void>
  keychronSetMixedRGBEffects(regionIndex: number, startIndex: number, effects: import('./types/keychron').MixedRGBEffect[]): Promise<void>
  keychronSaveRGB(): Promise<void>
  setVialRGBMode(mode: number, speed: number, h: number, s: number, v: number): Promise<void>
  keychronAnalogSetProfileName(profile: number, name: string): Promise<boolean>
  keychronAnalogSetTravel(profile: number, mode: number, actPt: number, sens: number, rlsSens: number, entire: boolean, rowMask?: number[]): Promise<boolean>
  keychronAnalogSetAdvanceModeToggle(profile: number, row: number, col: number): Promise<boolean>
  keychronAnalogSetAdvanceModeDks(profile: number, row: number, col: number, okmcIndex: number, shallowAct: number, shallowDeact: number, deepAct: number, deepDeact: number, keycodes: number[], actions: number[]): Promise<boolean>
  keychronAnalogSetSocd(profile: number, row1: number, col1: number, row2: number, col2: number, index: number, socdType: number): Promise<boolean>
  keychronAnalogSaveProfile(profile: number): Promise<boolean>
  keychronAnalogSetCurve(curvePoints: number[]): Promise<boolean>
  keychronAnalogSetGameControllerMode(mode: number): Promise<boolean>
  keychronAnalogSetProfile(profileIndex: number): Promise<boolean>
}

export async function restoreKeychronSettings(
  data: Record<string, unknown>,
  state: KeychronState,
  api: KeychronRestoreAPI,
  rows: number,
  cols: number,
): Promise<void> {
  if (!data) return

  console.log('[KC-Restore] Starting restore with data keys:', Object.keys(data))
  console.log('[KC-Restore] State flags:', {
    hasDebounce: state.hasDebounce,
    hasNkro: state.hasNkro,
    nkroAdaptive: state.nkroAdaptive,
    hasReportRate: state.hasReportRate,
    hasWireless: state.hasWireless,
    hasSnapClick: state.hasSnapClick,
    snapClickCount: state.snapClickCount,
    hasRgb: state.hasRgb,
    rgb: state.rgb != null,
    hasAnalog: state.hasAnalog,
    analog: state.analog != null,
  })

  // --- Debounce ---
  if (data.debounce && state.hasDebounce) {
    const d = data.debounce as Record<string, number>
    console.log('[KC-Restore] Restoring debounce:', d)
    await api.keychronSetDebounce(
      d.type ?? state.debounceType,
      d.time ?? state.debounceTime,
    )
  }

  // --- NKRO ---
  if (data.nkro && state.hasNkro && !state.nkroAdaptive) {
    const n = data.nkro as Record<string, boolean>
    await api.keychronSetNkro(n.enabled ?? false)
  }

  // --- Report rate ---
  if (data.report_rate !== undefined && state.hasReportRate) {
    await api.keychronSetReportRate(data.report_rate as number)
  }
  if (data.report_rate_v2 && state.hasReportRate) {
    const rv2 = data.report_rate_v2 as Record<string, number>
    if (state.pollRateVersion === 2) {
      await api.keychronSetPollRateV2(
        rv2.usb ?? state.pollRateUsb,
        rv2.fr ?? state.pollRate24g,
      )
    } else {
      // Fallback: apply USB rate as single rate
      await api.keychronSetReportRate(rv2.usb ?? state.reportRate)
    }
  }

  // --- Wireless LPM ---
  if (data.wireless_lpm && state.hasWireless) {
    const w = data.wireless_lpm as Record<string, number>
    await api.keychronSetWirelessLpm(
      w.backlit_time ?? state.wirelessBacklitTime,
      w.idle_time ?? state.wirelessIdleTime,
    )
  }

  // --- Snap Click ---
  if (data.snap_click && state.hasSnapClick) {
    const entries = data.snap_click as Array<Record<string, number>>
    for (let i = 0; i < entries.length && i < state.snapClickCount; i++) {
      const e = entries[i]
      await api.keychronSetSnapClick(i, e.type ?? 0, e.key1 ?? 0, e.key2 ?? 0)
    }
    if (state.snapClickCount > 0) {
      await api.keychronSaveSnapClick()
    }
  }

  // --- RGB ---
  if (data.rgb && state.hasRgb) {
    const rgb = data.rgb as Record<string, unknown>

    // Per-key RGB type
    if (rgb.per_key_rgb_type !== undefined) {
      await api.keychronSetPerKeyRGBType(rgb.per_key_rgb_type as number)
    }

    // Per-key colors
    const colors = rgb.per_key_colors as number[][] | undefined
    if (colors) {
      const ledCount = state.rgb?.ledCount ?? 0
      for (let i = 0; i < colors.length && i < ledCount; i++) {
        const [h, s, v] = colors[i]
        await api.keychronSetPerKeyColor(i, h, s, v)
      }
    }

    // OS indicator config
    if (rgb.os_indicator && state.rgb?.osIndicatorConfig) {
      const ind = rgb.os_indicator as Record<string, number>
      await api.keychronSetIndicators(
        ind.disable_mask ?? 0,
        ind.hue ?? 0,
        ind.sat ?? 255,
        ind.val ?? 255,
      )
    }

    // Mixed RGB regions
    if (rgb.mixed_rgb_regions && state.rgb && state.rgb.mixedRGBLayers > 0) {
      let regions = rgb.mixed_rgb_regions as number[]
      const ledCount = state.rgb.ledCount
      regions = regions.slice(0, ledCount)
      await api.keychronSetMixedRGBRegions(0, regions)
    }

    // Mixed RGB effects
    if (rgb.mixed_rgb_effects && state.rgb && state.rgb.mixedRGBLayers > 0) {
      const layerEffects = rgb.mixed_rgb_effects as number[][][]
      for (let region = 0; region < layerEffects.length && region < state.rgb.mixedRGBLayers; region++) {
        const effects = layerEffects[region].map((e: number[]) => ({
          effect: e[0] ?? 0,
          hue: e[1] ?? 0,
          sat: e[2] ?? 0,
          speed: e[3] ?? 0,
          time: e[4] ?? 0,
        }))
        await api.keychronSetMixedRGBEffects(region, 0, effects)
      }
    }

    // Flush RGB to EEPROM
    await api.keychronSaveRGB()

    // VialRGB global effect (mode/speed/HSV)
    // Must happen AFTER saveRGB so per-key data is written first
    if (rgb.vialrgb_mode !== undefined) {
      const mode = rgb.vialrgb_mode as number
      const speed = (rgb.vialrgb_speed as number) ?? 128
      const hsv = (rgb.vialrgb_hsv as number[]) ?? [0, 255, 255]
      await api.setVialRGBMode(mode, speed, hsv[0], hsv[1], hsv[2])
    }
  }

  // --- Analog ---
  if (data.analog && state.hasAnalog) {
    const analog = data.analog as Record<string, unknown>
    const profileCount = state.analog?.profileCount ?? 0
    const profiles = (analog.profiles as Array<Record<string, unknown>>) ?? []

    for (let p = 0; p < profiles.length && p < profileCount; p++) {
      const prof = profiles[p]

      // Profile name
      const name = prof.name as string | undefined
      if (name) {
        await api.keychronAnalogSetProfileName(p, name)
      }

      // Key configs — find most common travel combo and apply globally first
      const keyConfigs = prof.key_configs as Record<string, Record<string, number>> | undefined
      if (keyConfigs && rows > 0 && cols > 0) {
        // Parse configs
        const parsed: Array<{ r: number; c: number; cfg: Record<string, number> }> = []
        for (const [keyStr, cfg] of Object.entries(keyConfigs)) {
          const parts = keyStr.split(',').map(Number)
          if (parts.length === 2 && parts[0] < rows && parts[1] < cols) {
            parsed.push({ r: parts[0], c: parts[1], cfg })
          }
        }

        if (parsed.length > 0) {
          // Find most common travel combo to set globally
          const travelKey = (cfg: Record<string, number>): string => {
            const mode = cfg.mode ?? pick(cfg, 'mode', 'mode') as number ?? 1
            const act = (pick(cfg, 'actuation_point', 'actuationPoint') as number) ?? 20
            const sens = cfg.sensitivity ?? 3
            const rls = (pick(cfg, 'release_sensitivity', 'releaseSensitivity') as number) ?? 3
            return `${mode},${act},${sens},${rls}`
          }
          const counts: Record<string, number> = {}
          for (const { cfg } of parsed) {
            const k = travelKey(cfg)
            counts[k] = (counts[k] ?? 0) + 1
          }
          const mostCommonKey = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
          const [modeG, actPtG, sensG, rlsG] = mostCommonKey.split(',').map(Number)

          // Apply globally
          await api.keychronAnalogSetTravel(p, modeG, actPtG, sensG, rlsG, true)

          // Apply per-key overrides for keys that differ
          const overrideGroups: Record<string, Array<{ r: number; c: number }>> = {}
          for (const { r, c, cfg } of parsed) {
            const k = travelKey(cfg)
            if (k !== mostCommonKey) {
              if (!overrideGroups[k]) overrideGroups[k] = []
              overrideGroups[k].push({ r, c })
            }
          }
          for (const [key, keys] of Object.entries(overrideGroups)) {
            const [modeO, actPtO, sensO, rlsO] = key.split(',').map(Number)
            const rowMask = new Array(rows).fill(0)
            for (const { r, c } of keys) {
              rowMask[r] |= 1 << c
            }
            await api.keychronAnalogSetTravel(p, modeO, actPtO, sensO, rlsO, false, rowMask)
          }

          // Restore advance modes per key
          for (const { r, c, cfg } of parsed) {
            const adv = (pick(cfg, 'adv_mode', 'advMode') as number) ?? 0
            const advData = (pick(cfg, 'adv_mode_data', 'advModeData') as number) ?? 0
            if (adv === 3) {
              // ADV_MODE_TOGGLE
              await api.keychronAnalogSetAdvanceModeToggle(p, r, c)
            } else if (adv === 1) {
              // ADV_MODE_OKMC (DKS)
              const okmcList = (prof.okmc_configs as Array<Record<string, unknown>>) ?? []
              if (advData < okmcList.length) {
                const slot = okmcList[advData]
                await api.keychronAnalogSetAdvanceModeDks(
                  p, r, c, advData,
                  (pick(slot, 'shallow_act', 'shallowAct') as number) ?? 0,
                  (pick(slot, 'shallow_deact', 'shallowDeact') as number) ?? 0,
                  (pick(slot, 'deep_act', 'deepAct') as number) ?? 0,
                  (pick(slot, 'deep_deact', 'deepDeact') as number) ?? 0,
                  (slot.keycodes as number[]) ?? [0, 0, 0, 0],
                  (pick(slot, 'actions', 'events') as number[]) ?? [0, 0, 0, 0],
                )
              }
            }
            // ADV_MODE_CLEAR (0) — nothing to do
          }
        }
      }

      // Restore SOCD pairs
      const socdPairs = prof.socd_pairs as Array<Record<string, number>> | undefined
      const socdCount = state.analog?.socdCount ?? 0
      if (socdPairs) {
        for (let i = 0; i < socdPairs.length && i < socdCount; i++) {
          const pair = socdPairs[i]
          await api.keychronAnalogSetSocd(
            p,
            (pick(pair, 'row1', 'key1Row') as number) ?? 0,
            (pick(pair, 'col1', 'key1Col') as number) ?? 0,
            (pick(pair, 'row2', 'key2Row') as number) ?? 0,
            (pick(pair, 'col2', 'key2Col') as number) ?? 0,
            i,
            pair.type ?? 0,
          )
        }
      }

      // Flush profile to EEPROM
      await api.keychronAnalogSaveProfile(p)
    }

    // Global analog settings
    const curve = analog.curve as number[] | undefined
    if (curve && curve.length >= 4) {
      await api.keychronAnalogSetCurve(curve)
    }
    if (analog.game_controller_mode !== undefined) {
      await api.keychronAnalogSetGameControllerMode(analog.game_controller_mode as number)
    }
    // Re-select current profile last
    if (analog.current_profile !== undefined) {
      const cp = analog.current_profile as number
      if (cp < profileCount) {
        await api.keychronAnalogSetProfile(cp)
      }
    }
  }
}
