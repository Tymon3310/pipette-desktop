// SPDX-License-Identifier: GPL-3.0-or-later

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { KeychronRGBState, MixedRGBEffect } from '../../../shared/types/keychron'
import { HSVColorPicker } from './HSVColorPicker'
import { KeyboardWidget } from '../keyboard/KeyboardWidget'
import type { KleKey } from '../../../shared/kle/types'
import { PER_KEY_RGB_TYPE_NAMES, PER_KEY_RGB_SOLID } from '../../../shared/constants/keychron'
import { VIALRGB_EFFECTS } from '../../../shared/constants/lighting'

// Keychron custom VialRGB effect IDs
const EFFECT_PER_KEY_RGB = 48
const EFFECT_MIXED_RGB = 49

// Distinct zone colors (saturated, evenly spaced hues)
const ZONE_COLORS = [
  'hsl(210, 80%, 55%)', // blue
  'hsl(0, 80%, 55%)', // red
  'hsl(120, 70%, 45%)', // green
  'hsl(45, 90%, 50%)', // amber
  'hsl(280, 70%, 55%)', // purple
  'hsl(180, 70%, 45%)', // teal
  'hsl(330, 75%, 55%)', // pink
  'hsl(60, 85%, 42%)', // yellow-green
]

/** Convert QMK-style HSV (0-255 each) to a CSS hsl() string. */
function hsvToCSS(h: number, s: number, v: number): string {
  const hDeg = Math.round((h / 255) * 360)
  const sPct = Math.round((s / 255) * 100)
  const lPct = Math.round(((v / 255) * (200 - (s / 255) * 100)) / 2)
  return `hsl(${hDeg}, ${sPct}%, ${lPct}%)`
}

interface Props {
  rgb: KeychronRGBState
  ledMatrix: Map<string, number>
  keys: KleKey[]
  // Global VialRGB state
  vialRGBMode: number
  vialRGBSpeed: number
  vialRGBHue: number
  vialRGBSat: number
  vialRGBVal: number
  vialRGBMaxBrightness: number
  vialRGBSupported: number[]
  // Setters
  onSetVialRGBMode: (mode: number) => void
  onSetVialRGBSpeed: (speed: number) => void
  onSetVialRGBColor: (h: number, s: number) => void
  onSetVialRGBBrightness: (v: number) => void
}

export function KeychronRGB({
  rgb,
  ledMatrix,
  keys,
  vialRGBMode,
  vialRGBSpeed,
  vialRGBHue,
  vialRGBSat,
  vialRGBVal,
  vialRGBMaxBrightness,
  vialRGBSupported,
  onSetVialRGBMode,
  onSetVialRGBSpeed,
  onSetVialRGBColor,
  onSetVialRGBBrightness,
}: Props) {
  const { t } = useTranslation()
  const api = window.vialAPI

  // Build effect list: Keychron custom effects first, then standard VialRGB effects
  const effectList = useMemo(() => {
    const effects: { id: number; name: string }[] = [
      { id: EFFECT_PER_KEY_RGB, name: 'Per-Key RGB' },
      { id: EFFECT_MIXED_RGB, name: 'Mixed RGB' },
    ]
    const supportedSet = new Set(vialRGBSupported)
    for (const eff of VIALRGB_EFFECTS) {
      // Skip if already added (custom effects might overlap)
      if (effects.some((e) => e.id === eff.index)) continue
      // If keyboard declares supported effects, filter; otherwise add all
      if (supportedSet.size > 0 && !supportedSet.has(eff.index)) continue
      effects.push({ id: eff.index, name: eff.name })
    }
    return effects
  }, [vialRGBSupported])

  const isPerKeyActive = vialRGBMode === EFFECT_PER_KEY_RGB
  const isMixedActive = vialRGBMode === EFFECT_MIXED_RGB

  // OS Indicators state
  const [indHue, setIndHue] = useState(rgb.osIndicatorConfig?.hue ?? 0)
  const [indSat, setIndSat] = useState(rgb.osIndicatorConfig?.sat ?? 255)
  const [indVal, setIndVal] = useState(rgb.osIndicatorConfig?.val ?? 255)
  const [indMask, setIndMask] = useState(rgb.osIndicatorConfig?.disableMask ?? 0)

  // Per-Key RGB state
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [perKeyType, setPerKeyType] = useState<number>(rgb.perKeyRGBType ?? PER_KEY_RGB_SOLID)
  const [perKeyHue, setPerKeyHue] = useState<number>(0)
  const [perKeySat, setPerKeySat] = useState<number>(255)
  const [perKeyVal, setPerKeyVal] = useState<number>(255)

  // Debounced save timer
  const saveTimerRef = useRef<number | null>(null)

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(async () => {
      await api.keychronSaveRGB()
    }, 1000)
  }, [api])

  const updateIndicators = useCallback(
    async (mask: number, h: number, s: number, v: number) => {
      setIndMask(mask)
      setIndHue(h)
      setIndSat(s)
      setIndVal(v)
      await api.keychronSetIndicators(mask, h, s, v)
      scheduleSave()
    },
    [api, scheduleSave],
  )

  const handleKeyClick = useCallback(
    (key: KleKey, _maskClicked: boolean, event?: { ctrlKey: boolean; shiftKey: boolean }) => {
      const pos = `${key.row},${key.col}`
      setSelectedKeys((prev) => {
        const next = new Set(prev)
        if (event?.ctrlKey) {
          if (next.has(pos)) next.delete(pos)
          else next.add(pos)
        } else if (event?.shiftKey) {
          next.add(pos)
        } else {
          if (next.has(pos) && next.size === 1) {
            next.clear()
          } else {
            next.clear()
            next.add(pos)
          }
        }
        return next
      })
    },
    [],
  )

  const handleSelectAll = useCallback(() => {
    const all = new Set<string>()
    for (const key of keys) {
      if (ledMatrix.has(`${key.row},${key.col}`)) {
        all.add(`${key.row},${key.col}`)
      }
    }
    setSelectedKeys(all)
  }, [keys, ledMatrix])

  const handleDeselectAll = useCallback(() => {
    setSelectedKeys(new Set())
  }, [])

  // Local state for immediate per-key preview updates
  const [localPerKeyColors, setLocalPerKeyColors] = useState<[number, number, number][]>(
    rgb.perKeyColors ?? [],
  )

  useEffect(() => {
    setLocalPerKeyColors(rgb.perKeyColors ?? [])
  }, [rgb.perKeyColors])

  // Mixed RGB State
  const [selectedMixedKeys, setSelectedMixedKeys] = useState<Set<string>>(new Set())
  const [mixedRegionToApply, setMixedRegionToApply] = useState<number>(0)

  // Mixed RGB Region assignments (LED idx -> Region ID)
  const [localMixedRegions, setLocalMixedRegions] = useState<number[]>(rgb.mixedRGBRegions ?? [])

  // --- Color preview maps ---

  // Per-Key RGB: build row,col -> CSS color from per-key HSV + LED matrix
  const perKeyColorMap = useMemo(() => {
    const m = new Map<string, string>()
    if (localPerKeyColors.length === 0) return m

    for (const [pos, ledIdx] of ledMatrix.entries()) {
      if (ledIdx < localPerKeyColors.length) {
        const [h, s, v] = localPerKeyColors[ledIdx]
        if (h !== 0 || s !== 0 || v !== 0) {
          m.set(pos, hsvToCSS(h, s, v))
        }
      }
    }
    return m
  }, [localPerKeyColors, ledMatrix])

  // Mixed RGB: build row,col -> zone color from region assignments
  const mixedZoneColorMap = useMemo(() => {
    const m = new Map<string, string>()
    if (localMixedRegions.length === 0) return m

    for (const [pos, ledIdx] of ledMatrix.entries()) {
      if (ledIdx < localMixedRegions.length) {
        const region = localMixedRegions[ledIdx]
        m.set(pos, ZONE_COLORS[region % ZONE_COLORS.length])
      }
    }
    return m
  }, [localMixedRegions, ledMatrix])

  // Mixed RGB Effects state
  const [mixedRegionEffectTab, setMixedRegionEffectTab] = useState<number>(0)

  // Create local map for UI updates: Region -> MixedRGBEffect[]
  const [localMixedEffects, setLocalMixedEffects] = useState<Map<number, MixedRGBEffect[]>>(() => {
    const m = new Map<number, MixedRGBEffect[]>()
    if (rgb.mixedRGBEffects) {
      for (const [regionIdx, effects] of rgb.mixedRGBEffects.entries()) {
        m.set(regionIdx, [...effects])
      }
    }
    return m
  })

  const sendMixedEffects = useCallback(
    async (regionIdx: number, slots: MixedRGBEffect[]) => {
      if (!api.keychronSetMixedRGBEffects) return
      await api.keychronSetMixedRGBEffects(regionIdx, 0, slots)
      scheduleSave()
    },
    [api, scheduleSave],
  )

  const handleMixedKeyClick = useCallback(
    (key: KleKey, _maskClicked: boolean, event?: { ctrlKey: boolean; shiftKey: boolean }) => {
      const pos = `${key.row},${key.col}`
      setSelectedMixedKeys((prev) => {
        const next = new Set(prev)
        if (event?.ctrlKey) {
          if (next.has(pos)) next.delete(pos)
          else next.add(pos)
        } else if (event?.shiftKey) {
          next.add(pos)
        } else {
          if (next.has(pos) && next.size === 1) {
            next.clear()
          } else {
            next.clear()
            next.add(pos)
          }
        }
        return next
      })
    },
    [],
  )

  const handleMixedSelectAll = useCallback(() => {
    const all = new Set<string>()
    for (const key of keys) {
      if (ledMatrix.has(`${key.row},${key.col}`)) {
        all.add(`${key.row},${key.col}`)
      }
    }
    setSelectedMixedKeys(all)
  }, [keys, ledMatrix])

  const handleMixedDeselectAll = useCallback(() => {
    setSelectedMixedKeys(new Set())
  }, [])

  const handleApplyRegion = useCallback(async () => {
    if (selectedMixedKeys.size === 0) return

    const selectedKeysArray = Array.from(selectedMixedKeys)
    const newRegions = [...localMixedRegions]
    let anyApplied = false

    for (const pos of selectedKeysArray) {
      const idx = ledMatrix.get(pos)
      if (idx !== undefined) {
        while (newRegions.length <= idx) newRegions.push(0)
        newRegions[idx] = mixedRegionToApply
        anyApplied = true
      }
    }

    if (anyApplied) {
      setLocalMixedRegions(newRegions)
      await api.keychronSetMixedRGBRegions(0, newRegions)
      scheduleSave()
    }
  }, [selectedMixedKeys, mixedRegionToApply, ledMatrix, api, scheduleSave, localMixedRegions])

  const handleApplyColor = useCallback(async () => {
    if (selectedKeys.size === 0) return

    const selectedKeysArray = Array.from(selectedKeys)
    let anyApplied = false

    for (const pos of selectedKeysArray) {
      const idx = ledMatrix.get(pos)
      if (idx !== undefined) {
        anyApplied = true
      }
    }

    if (anyApplied) {
      setLocalPerKeyColors((prev) => {
        const next = [...prev]
        for (const pos of selectedKeysArray) {
          const idx = ledMatrix.get(pos)
          if (idx !== undefined) {
            while (next.length <= idx) next.push([0, 0, 0])
            next[idx] = [perKeyHue, perKeySat, perKeyVal]
          }
        }
        return next
      })

      for (const pos of selectedKeysArray) {
        const idx = ledMatrix.get(pos)
        if (idx !== undefined) {
          await api.keychronSetPerKeyColor(idx, perKeyHue, perKeySat, perKeyVal)
        }
      }
      scheduleSave()
    }
  }, [selectedKeys, perKeyHue, perKeySat, perKeyVal, ledMatrix, api, scheduleSave])

  const handleTypeChange = useCallback(
    async (type: number) => {
      setPerKeyType(type)
      await api.keychronSetPerKeyRGBType(type)
      scheduleSave()
    },
    [api, scheduleSave],
  )

  const emptyKeycodes = useRef(new Map<string, string>()).current

  const btnClass =
    'rounded-md border border-edge bg-surface px-3 py-1.5 text-sm hover:bg-surface-hover transition-colors'
  const disabledClass = 'pointer-events-none opacity-40'

  return (
    <div className="flex flex-col gap-6" data-testid="keychron-rgb-editor">
      {/* ===== Global RGB Mode ===== */}
      <Section title={t('keychron.globalRgbMode', 'Global RGB Mode')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">{t('keychron.effect', 'Effect:')}</label>
              <select
                className="rounded border border-edge bg-surface px-3 py-1.5 text-sm"
                value={vialRGBMode}
                onChange={(e) => onSetVialRGBMode(Number(e.target.value))}
                data-testid="keychron-rgb-mode"
              >
                {effectList.map((eff) => (
                  <option key={eff.id} value={eff.id}>
                    {eff.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-content-muted">
                {t('keychron.brightness', 'Brightness:')}
              </label>
              <input
                type="range"
                min={0}
                max={vialRGBMaxBrightness}
                value={vialRGBVal}
                onChange={(e) => onSetVialRGBBrightness(Number(e.target.value))}
                className="w-32"
                data-testid="keychron-rgb-brightness"
              />
              <span className="w-8 text-xs text-content-muted tabular-nums">{vialRGBVal}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-content-muted">{t('keychron.speed', 'Speed:')}</label>
              <input
                type="range"
                min={0}
                max={255}
                value={vialRGBSpeed}
                onChange={(e) => onSetVialRGBSpeed(Number(e.target.value))}
                className="w-32"
                data-testid="keychron-rgb-speed"
              />
              <span className="w-8 text-xs text-content-muted tabular-nums">{vialRGBSpeed}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-content-muted">{t('keychron.color', 'Color:')}</span>
            <HSVColorPicker
              hue={vialRGBHue}
              saturation={vialRGBSat}
              value={255}
              onHueChange={(h) => onSetVialRGBColor(h, vialRGBSat)}
              onSaturationChange={(s) => onSetVialRGBColor(vialRGBHue, s)}
              onValueChange={() => {}}
            />
          </div>
        </div>
      </Section>

      {/* ===== OS Indicators ===== */}
      {rgb.osIndicatorConfig && (
        <Section title={t('keychron.osIndicators', 'OS Indicators')}>
          <div className="flex gap-8">
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(indMask & 0x01) !== 0}
                  onChange={() => updateIndicators(indMask ^ 0x01, indHue, indSat, indVal)}
                />
                {t('keychron.disableNumLock', 'Disable Num Lock Indicator')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(indMask & 0x02) !== 0}
                  onChange={() => updateIndicators(indMask ^ 0x02, indHue, indSat, indVal)}
                />
                {t('keychron.disableCapsLock', 'Disable Caps Lock Indicator')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(indMask & 0x04) !== 0}
                  onChange={() => updateIndicators(indMask ^ 0x04, indHue, indSat, indVal)}
                />
                {t('keychron.disableScrollLock', 'Disable Scroll Lock Indicator')}
              </label>
            </div>
            <div className="pl-4 border-l border-edge">
              <span className="mb-2 block text-sm font-medium text-content-muted">
                {t('keychron.indicatorColor', 'Indicator Color')}
              </span>
              <HSVColorPicker
                hue={indHue}
                saturation={indSat}
                value={indVal}
                onHueChange={(h) => updateIndicators(indMask, h, indSat, indVal)}
                onSaturationChange={(s) => updateIndicators(indMask, indHue, s, indVal)}
                onValueChange={(v) => updateIndicators(indMask, indHue, indSat, v)}
                onColorChange={(h, s, v) => updateIndicators(indMask, h, s, v)}
              />
            </div>
          </div>
        </Section>
      )}

      {/* ===== Per-Key RGB ===== */}
      <Section title={t('keychron.perKeyRgb', 'Per-Key RGB')}>
        {!isPerKeyActive && (
          <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning">
            {t(
              'keychron.perKeyNotActive',
              'Per-Key RGB is not the active effect. Select "Per-Key RGB" in the Global RGB Mode dropdown above to edit key colors.',
            )}
          </div>
        )}
        <div className={`flex flex-col gap-4 ${!isPerKeyActive ? disabledClass : ''}`}>
          <div className="flex items-center gap-4">
            <button className={btnClass} onClick={handleSelectAll}>
              {t('editor.keymap.selectAll', 'Select All')}
            </button>
            <button className={btnClass} onClick={handleDeselectAll}>
              {t('editor.keymap.deselectAll', 'Deselect All')}
            </button>
            <span className="text-sm text-content-muted">
              {selectedKeys.size} {t('common.selected', 'selected')}
            </span>
          </div>

          <div className="flex justify-center rounded-lg border border-edge bg-surface-alt p-4 overflow-x-auto">
            <KeyboardWidget
              keys={keys}
              keycodes={emptyKeycodes}
              multiSelectedKeys={selectedKeys}
              keyColors={perKeyColorMap}
              onKeyClick={isPerKeyActive ? handleKeyClick : undefined}
            />
          </div>

          <div className="flex flex-col gap-6 mt-4 sm:flex-row">
            <div className="flex-1 rounded-lg border border-edge p-4 bg-surface-alt">
              <span className="mb-3 block text-sm font-medium text-content">
                {t('keychron.perKeyEffectType', 'Effect Type')}
              </span>
              <p className="text-xs text-content-muted mb-3 flex-1">
                {t(
                  'keychron.perKeyEffectDescription',
                  'Choose the animation effect that plays on top of your custom per-key colors.',
                )}
              </p>
              <div className="flex flex-col gap-2">
                <select
                  className="rounded border border-edge bg-surface px-3 py-1.5 text-sm"
                  value={perKeyType}
                  onChange={(e) => handleTypeChange(Number(e.target.value))}
                  disabled={!isPerKeyActive}
                >
                  {Object.entries(PER_KEY_RGB_TYPE_NAMES).map(([val, name]) => (
                    <option key={val} value={val}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col rounded-lg border border-edge p-4 bg-surface-alt items-center">
              <div className="mb-4">
                <HSVColorPicker
                  hue={perKeyHue}
                  saturation={perKeySat}
                  value={perKeyVal}
                  onHueChange={setPerKeyHue}
                  onSaturationChange={setPerKeySat}
                  onValueChange={setPerKeyVal}
                />
              </div>
              <button
                className="w-full rounded bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                onClick={handleApplyColor}
                disabled={selectedKeys.size === 0 || !isPerKeyActive}
              >
                {t('keychron.applyColor', 'Apply to Selected Keys')}
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* ===== Mixed RGB ===== */}
      {rgb.mixedRGBLayers !== undefined && rgb.mixedRGBLayers > 0 && (
        <Section title={t('keychron.mixedRgb', 'Mixed RGB')}>
          {!isMixedActive && (
            <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning">
              {t(
                'keychron.mixedNotActive',
                'Mixed RGB is not the active effect. Select "Mixed RGB" in the Global RGB Mode dropdown above to edit zones.',
              )}
            </div>
          )}
          <div className={`flex flex-col gap-4 ${!isMixedActive ? disabledClass : ''}`}>
            <p className="text-sm text-content-muted">
              {t(
                'keychron.mixedRgbDescription',
                'Divide your keyboard into regions, each with its own effect playlist.',
              )}
            </p>

            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">
                {t('keychron.paintRegion', 'Paint Region:')}
              </span>
              <select
                className="rounded border border-edge bg-surface px-3 py-1.5 text-sm"
                value={mixedRegionToApply}
                onChange={(e) => setMixedRegionToApply(Number(e.target.value))}
                disabled={!isMixedActive}
              >
                {Array.from({ length: rgb.mixedRGBLayers }).map((_, i) => (
                  <option key={i} value={i}>
                    {t('keychron.regionN', { defaultValue: `Region ${i}`, n: i })}
                  </option>
                ))}
              </select>
              <button
                className="rounded-md border border-edge bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
                onClick={handleApplyRegion}
                disabled={selectedMixedKeys.size === 0 || !isMixedActive}
              >
                {t('keychron.applyToSelected', 'Apply to Selected Keys')}
              </button>
            </div>

            <div className="flex items-center gap-4">
              <button className={btnClass} onClick={handleMixedSelectAll}>
                {t('editor.keymap.selectAll', 'Select All')}
              </button>
              <button className={btnClass} onClick={handleMixedDeselectAll}>
                {t('editor.keymap.deselectAll', 'Deselect All')}
              </button>
              <span className="text-sm text-content-muted">
                {selectedMixedKeys.size} {t('common.selected', 'selected')}
              </span>
            </div>

            <div className="flex justify-center rounded-lg border border-edge bg-surface-alt p-4 overflow-x-auto">
              <KeyboardWidget
                keys={keys}
                keycodes={emptyKeycodes}
                multiSelectedKeys={selectedMixedKeys}
                keyColors={mixedZoneColorMap}
                onKeyClick={isMixedActive ? handleMixedKeyClick : undefined}
              />
            </div>

            {/* Region Effects Tabs */}
            <div className="mt-4">
              <div className="flex border-b border-edge">
                {Array.from({ length: rgb.mixedRGBLayers }).map((_, i) => (
                  <button
                    key={i}
                    className={`px-4 py-2 text-sm font-medium ${
                      mixedRegionEffectTab === i
                        ? 'border-b-2 border-accent text-accent'
                        : 'text-content-muted hover:text-content hover:bg-surface-hover'
                    }`}
                    onClick={() => setMixedRegionEffectTab(i)}
                  >
                    {t('keychron.regionN', { defaultValue: `Region ${i}`, n: i })}
                  </button>
                ))}
              </div>

              <div className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {localMixedEffects.get(mixedRegionEffectTab)?.map((slot, slotIdx) => (
                  <div
                    key={slotIdx}
                    className="rounded border border-edge bg-surface-alt p-3 flex flex-col gap-3"
                  >
                    <span className="text-sm font-semibold text-content">
                      {t('keychron.effectSlot', {
                        defaultValue: `Effect ${slotIdx + 1}`,
                        n: slotIdx + 1,
                      })}
                    </span>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-content-muted">Effect</label>
                      <select
                        className="rounded border border-edge bg-surface px-2 py-1 text-sm"
                        value={slot.effect}
                        disabled={!isMixedActive}
                        onChange={(e) => {
                          const val = Number(e.target.value)
                          setLocalMixedEffects((prev) => {
                            const next = new Map(prev)
                            const slots = [...(next.get(mixedRegionEffectTab) || [])]
                            slots[slotIdx] = { ...slots[slotIdx], effect: val }
                            next.set(mixedRegionEffectTab, slots)
                            sendMixedEffects(mixedRegionEffectTab, slots)
                            return next
                          })
                        }}
                      >
                        <option value={0}>Disabled</option>
                        {VIALRGB_EFFECTS.slice(1).map((eff) => (
                          <option key={eff.index} value={eff.index}>
                            {eff.name}
                          </option>
                        ))}
                      </select>

                      <div className="flex gap-4">
                        <div className="flex-1">
                          <label className="text-xs text-content-muted">Speed: {slot.speed}</label>
                          <input
                            type="range"
                            min="0"
                            max="255"
                            className="w-full"
                            value={slot.speed}
                            disabled={!isMixedActive}
                            onChange={(e) => {
                              const val = Number(e.target.value)
                              setLocalMixedEffects((prev) => {
                                const next = new Map(prev)
                                const slots = [...(next.get(mixedRegionEffectTab) || [])]
                                slots[slotIdx] = { ...slots[slotIdx], speed: val }
                                next.set(mixedRegionEffectTab, slots)
                                sendMixedEffects(mixedRegionEffectTab, slots)
                                return next
                              })
                            }}
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-content-muted">
                            Duration: {slot.time ?? 0} ms
                          </label>
                          <input
                            type="number"
                            min="100"
                            max="60000"
                            step="100"
                            className="w-full rounded border border-edge bg-surface px-2 py-1 text-sm"
                            value={slot.time}
                            disabled={!isMixedActive}
                            onChange={(e) => {
                              const val = Number(e.target.value)
                              setLocalMixedEffects((prev) => {
                                const next = new Map(prev)
                                const slots = [...(next.get(mixedRegionEffectTab) || [])]
                                slots[slotIdx] = { ...slots[slotIdx], time: val }
                                next.set(mixedRegionEffectTab, slots)
                                sendMixedEffects(mixedRegionEffectTab, slots)
                                return next
                              })
                            }}
                          />
                        </div>
                      </div>

                      <details className="mt-2 text-sm text-content-muted">
                        <summary className="cursor-pointer hover:text-content">
                          Color Picker
                        </summary>
                        <div className="mt-2 bg-surface p-2 rounded">
                          <HSVColorPicker
                            hue={slot.hue}
                            saturation={slot.sat}
                            value={255}
                            onHueChange={(h) => {
                              setLocalMixedEffects((prev) => {
                                const next = new Map(prev)
                                const slots = [...(next.get(mixedRegionEffectTab) || [])]
                                slots[slotIdx] = { ...slots[slotIdx], hue: h }
                                next.set(mixedRegionEffectTab, slots)
                                sendMixedEffects(mixedRegionEffectTab, slots)
                                return next
                              })
                            }}
                            onSaturationChange={(s) => {
                              setLocalMixedEffects((prev) => {
                                const next = new Map(prev)
                                const slots = [...(next.get(mixedRegionEffectTab) || [])]
                                slots[slotIdx] = { ...slots[slotIdx], sat: s }
                                next.set(mixedRegionEffectTab, slots)
                                sendMixedEffects(mixedRegionEffectTab, slots)
                                return next
                              })
                            }}
                            onValueChange={() => {
                              /* firmware mixed effects don't include V */
                            }}
                          />
                        </div>
                      </details>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-edge bg-surface p-4">
      <h3 className="mb-4 text-sm font-semibold text-content">{title}</h3>
      {children}
    </section>
  )
}
