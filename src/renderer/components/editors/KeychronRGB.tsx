// SPDX-License-Identifier: GPL-3.0-or-later

import { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { KeychronRGBState } from '../../../shared/types/keychron'
import { HSVColorPicker } from './HSVColorPicker'
import { KeyboardWidget } from '../keyboard/KeyboardWidget'
import type { KleKey } from '../../../shared/kle/types'
import {
  PER_KEY_RGB_TYPE_NAMES,
  PER_KEY_RGB_SOLID,
} from '../../../shared/constants/keychron'

interface Props {
  rgb: KeychronRGBState
  ledMatrix: Map<string, number>
  keys: KleKey[]
}

export function KeychronRGB({ rgb, ledMatrix, keys }: Props) {
  const { t } = useTranslation()
  const api = window.vialAPI

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
    (key: KleKey, maskClicked: boolean, event?: { ctrlKey: boolean; shiftKey: boolean }) => {
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

  // Mixed RGB State
  const [selectedMixedKeys, setSelectedMixedKeys] = useState<Set<string>>(new Set())
  const [mixedRegionToApply, setMixedRegionToApply] = useState<number>(0)
  
  // Mixed RGB Region assignments (LED idx -> Region ID)
  // Only valid if the keyboard supports Mixed RGB (rgb.mixedRGBLayers > 0)
  const [localMixedRegions, setLocalMixedRegions] = useState<number[]>(rgb.mixedRGBRegions ?? [])

  // Mixed RGB Effects state
  const [mixedRegionEffectTab, setMixedRegionEffectTab] = useState<number>(0)
  
  // Create local map for UI updates: Region -> Array of {effect, speed, hue, sat, val, time?}
  const [localMixedEffects, setLocalMixedEffects] = useState<
    Map<number, Array<{ effect: number; speed: number; hue: number; sat: number; val: number; time?: number }>>
  >(() => {
    const m = new Map()
    if (rgb.mixedRGBEffects) {
      for (const [regionIdx, rawBytes] of rgb.mixedRGBEffects.entries()) {
        const slots = []
        // Each effect slot is 8 bytes in memory based on the C struct
        for (let i = 0; i < rawBytes.length; i += 8) {
          if (i + 7 < rawBytes.length) {
            slots.push({
              effect: rawBytes[i],
              speed: rawBytes[i + 1],
              hue: rawBytes[i + 2],
              sat: rawBytes[i + 3],
              val: rawBytes[i + 4],
              time: rawBytes[i + 5] | (rawBytes[i + 6] << 8),
            })
          }
        }
        m.set(regionIdx, slots)
      }
    }
    return m
  })

  // Pre-bind a helper that ensures there is a full payload to send per region
  const sendMixedEffects = useCallback(async (regionIdx: number, slots: Array<{ effect: number; speed: number; hue: number; sat: number; val: number; time?: number }>) => {
    if (!api.keychronSetMixedRGBEffects) return
    const rawData: number[] = []
    slots.forEach(slot => {
      rawData.push(slot.effect)
      rawData.push(slot.speed)
      rawData.push(slot.hue)
      rawData.push(slot.sat)
      rawData.push(slot.val)
      rawData.push(slot.time ? slot.time & 0xFF : 0)
      rawData.push(slot.time ? (slot.time >> 8) & 0xFF : 0)
    })
    await api.keychronSetMixedRGBEffects(regionIdx, 0, rawData)
    scheduleSave()
  }, [api, scheduleSave])

  const handleMixedKeyClick = useCallback(
    (key: KleKey, maskClicked: boolean, event?: { ctrlKey: boolean; shiftKey: boolean }) => {
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
    let anyApplied = false
    setLocalMixedRegions((prev) => {
      const next = [...prev]
      // Ensure the array is long enough (up to led count)
      for (const pos of selectedKeysArray) {
        const idx = ledMatrix.get(pos) 
        if (idx !== undefined) {
          while (next.length <= idx) {
            next.push(0) // Default region 0
          }
          next[idx] = mixedRegionToApply
          anyApplied = true
        }
      }
      return next
    })

    if (anyApplied) {
      // Create a full array of regions to send to the keyboard
      const newRegions = [...localMixedRegions]
      for (const pos of selectedKeysArray) {
        const idx = ledMatrix.get(pos)
        if (idx !== undefined) {
          while (newRegions.length <= idx) newRegions.push(0)
          newRegions[idx] = mixedRegionToApply
        }
      }
      await api.keychronSetMixedRGBRegions(0, newRegions)
      scheduleSave()
    }
  }, [selectedMixedKeys, mixedRegionToApply, ledMatrix, api, scheduleSave, localMixedRegions])

  const handleApplyColor = useCallback(async () => {
    if (selectedKeys.size === 0) return

    const selectedKeysArray = Array.from(selectedKeys)
    let anyApplied = false
    
    // We update local component state if we wanted to display the colors on standard widget,
    // but the actual source of truth comes from `rgb.perKeyColors`. We just write out changes.
    for (const pos of selectedKeysArray) {
      const idx = ledMatrix.get(pos) 
      if (idx !== undefined) {
        anyApplied = true
      }
    }

    if (anyApplied) {
      // Send individual commands for each selected key that maps to a matrix position
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

  // Map keys to colors for KeyboardWidget
  // We can inject a style directly via DOM if KeyboardWidget doesn't support custom colors yet, 
  // but to keep it simple we aren't displaying actual LED colors on the widget in this PR unless requested.
  // We will just leave it as regular keys for now. 
  // TODO: Add custom styling for per_key LED colors to KeyboardWidget if requested.
  // For now we will rely on UI selections and apply.

  // Provide empty placeholder keycodes so the keyboard renders correctly and shows labels
  const emptyKeycodes = useRef(new Map<string, string>()).current

  return (
    <div className="flex flex-col gap-6" data-testid="keychron-rgb-editor">
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

      <Section title={t('keychron.perKeyRgb', 'Per-Key RGB')}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <button
              className="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm hover:bg-surface-hover"
              onClick={handleSelectAll}
            >
              {t('editor.keymap.selectAll', 'Select All')}
            </button>
            <button
              className="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm hover:bg-surface-hover"
              onClick={handleDeselectAll}
            >
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
              onKeyClick={handleKeyClick}
            />
          </div>

          <div className="flex flex-col gap-6 mt-4 sm:flex-row">
            <div className="flex-1 rounded-lg border border-edge p-4 bg-surface-alt">
              <span className="mb-3 block text-sm font-medium text-content">{t('keychron.perKeyEffectType', 'Effect Type')}</span>
              <p className="text-xs text-content-muted mb-3 flex-1">
                {t('keychron.perKeyEffectDescription', 'Choose the animation effect that plays on top of your custom per-key colors.')}
              </p>
              <div className="flex flex-col gap-2">
                <select
                  className="rounded border border-edge bg-surface px-3 py-1.5 text-sm"
                  value={perKeyType}
                  onChange={(e) => handleTypeChange(Number(e.target.value))}
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
                disabled={selectedKeys.size === 0}
              >
                {t('keychron.applyColor', 'Apply to Selected Keys')}
              </button>
            </div>
          </div>
        </div>
      </Section>

      {rgb.mixedRGBLayers !== undefined && rgb.mixedRGBLayers > 0 && (
        <Section title={t('keychron.mixedRgb', 'Mixed RGB')}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-content-muted">
              {t('keychron.mixedRgbDescription', 'Divide your keyboard into regions, each with its own effect playlist.')}
            </p>

            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">{t('keychron.paintRegion', 'Paint Region:')}</span>
              <select
                className="rounded border border-edge bg-surface px-3 py-1.5 text-sm"
                value={mixedRegionToApply}
                onChange={(e) => setMixedRegionToApply(Number(e.target.value))}
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
                disabled={selectedMixedKeys.size === 0}
              >
                {t('keychron.applyToSelected', 'Apply to Selected Keys')}
              </button>
            </div>

            <div className="flex items-center gap-4">
              <button
                className="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm hover:bg-surface-hover"
                onClick={handleMixedSelectAll}
              >
                {t('editor.keymap.selectAll', 'Select All')}
              </button>
              <button
                className="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm hover:bg-surface-hover"
                onClick={handleMixedDeselectAll}
              >
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
                onKeyClick={handleMixedKeyClick}
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
                  <div key={slotIdx} className="rounded border border-edge bg-surface-alt p-3 flex flex-col gap-3">
                    <span className="text-sm font-semibold text-content">
                      {t('keychron.effectSlot', { defaultValue: `Effect ${slotIdx + 1}`, n: slotIdx + 1 })}
                    </span>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-content-muted">Effect</label>
                      <select
                        className="rounded border border-edge bg-surface px-2 py-1 text-sm"
                        value={slot.effect}
                        onChange={(e) => {
                          const val = Number(e.target.value)
                          setLocalMixedEffects((prev) => {
                            const next = new Map(prev)
                            const slots = [...(next.get(mixedRegionEffectTab) || [])]
                            slots[slotIdx] = { ...slots[slotIdx], effect: val }
                            next.set(mixedRegionEffectTab, slots)
                            // Debounce or apply immediately
                            sendMixedEffects(mixedRegionEffectTab, slots)
                            return next
                          })
                        }}
                      >
                        <option value={0}>Disabled</option>
                        {/* Just using the basic VialRGB effects for now, as in python gui VIALRGB_EFFECTS[1:] */}
                        <option value={1}>Solid Color</option>
                        <option value={2}>Breathing</option>
                        <option value={3}>Band</option>
                        <option value={4}>Swipe</option>
                        <option value={5}>Cycle</option>
                        <option value={6}>Rainbow</option>
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
                          <label className="text-xs text-content-muted">Duration: {slot.time} ms</label>
                          <input
                            type="number"
                            min="100"
                            max="60000"
                            step="100"
                            className="w-full rounded border border-edge bg-surface px-2 py-1 text-sm"
                            value={slot.time}
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
                        <summary className="cursor-pointer hover:text-content">Color Picker</summary>
                        <div className="mt-2 bg-surface p-2 rounded">
                          <HSVColorPicker
                            hue={slot.hue}
                            saturation={slot.sat}
                            value={slot.val}
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
                            onValueChange={(v) => {
                              setLocalMixedEffects((prev) => {
                                const next = new Map(prev)
                                const slots = [...(next.get(mixedRegionEffectTab) || [])]
                                slots[slotIdx] = { ...slots[slotIdx], val: v }
                                next.set(mixedRegionEffectTab, slots)
                                sendMixedEffects(mixedRegionEffectTab, slots)
                                return next
                              })
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
