// SPDX-License-Identifier: GPL-3.0-or-later

import { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  KeychronAnalogState,
  AnalogKeyConfig,
  SOCDPair,
  OKMCSlotConfig,
} from '../../../shared/types/keychron'
import { KeyboardWidget } from '../keyboard/KeyboardWidget'
import { KEY_UNIT, KEYBOARD_PADDING } from '../keyboard/constants'
import type { KleKey } from '../../../shared/kle/types'
import {
  AKM_MODE_NAMES,
  AKM_REGULAR,
  AKM_RAPID,
  GC_MASK_XINPUT,
  GC_MASK_TYPING,
  CALIB_ZERO_TRAVEL_MANUAL,
  CALIB_FULL_TRAVEL_MANUAL,
  CALIB_SAVE_AND_EXIT,
  OKMC_ACTION_NAMES,
  OKMC_ACTION_NONE,
  SOCD_TYPE_NAMES,
} from '../../../shared/constants/keychron'
import { codeToLabel } from '../../../shared/keycodes/keycodes'

interface Props {
  analog: KeychronAnalogState
  keys: KleKey[]
  rows: number
  cols: number
  keymap: Map<string, number>
}

type AnalogTab = 'actuation' | 'socd' | 'gamepad' | 'calibration' | 'dks'

export function KeychronAnalog({ analog, keys, rows, cols, keymap }: Props) {
  const { t } = useTranslation()
  const api = window.vialAPI

  // Profile state
  const [currentProfile, setCurrentProfile] = useState(analog.currentProfile)
  const [profileNames, setProfileNames] = useState<string[]>(
    analog.profiles.map((p) => p.name || `Profile ${analog.profiles.indexOf(p) + 1}`),
  )
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  // Tab state
  const [activeTab, setActiveTab] = useState<AnalogTab>('actuation')

  // Global actuation settings
  const [globalActPt, setGlobalActPt] = useState(20) // 0.1mm units → 2.0mm
  const [globalSens, setGlobalSens] = useState(3)
  const [globalRlsSens, setGlobalRlsSens] = useState(3)
  const [globalMode, setGlobalMode] = useState(AKM_REGULAR)

  // Per-key selection
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  // SOCD state
  const [socdPairsState, setSocdPairsState] = useState<SOCDPair[]>(
    analog.profiles[currentProfile]?.socdPairs ?? [],
  )

  // DKS (OKMC) state
  const [activeDksSlot, setActiveDksSlot] = useState(0)
  const [dksConfigsState, setDksConfigsState] = useState<OKMCSlotConfig[]>(
    analog.profiles[currentProfile]?.okmcConfigs ?? [],
  )

  const [gcMode, setGcMode] = useState(analog.gameControllerMode)
  const [curve, setCurve] = useState<number[]>(
    analog.curve && analog.curve.length === 8 ? analog.curve : [0, 0, 85, 85, 170, 170, 255, 255],
  )

  // Calibration
  const [calibrating, setCalibrating] = useState(false)
  const [calibPhase, setCalibPhase] = useState<'idle' | 'zero' | 'full'>('idle')
  const calibIntervalRef = useRef<number | null>(null)

  // SOCD key-pick mode: { pairIndex, whichKey: 1|2 } or null
  const [socdPickMode, setSocdPickMode] = useState<{ pairIdx: number; whichKey: 1 | 2 } | null>(
    null,
  )

  // Dynamic keyboard widget scaling
  const kbContainerRef = useRef<HTMLDivElement>(null)
  const [kbScale, setKbScale] = useState(1)

  // Realtime travel (for calibration display)
  const [realtimeTravel, setRealtimeTravel] = useState<{
    travelMm: number
    value: number
    zero: number
    full: number
  } | null>(null)
  const [selectedCalibKey, setSelectedCalibKey] = useState<{ row: number; col: number } | null>(
    null,
  )

  // Load profile data when profile changes
  useEffect(() => {
    const profile = analog.profiles[currentProfile]
    if (!profile) return

    // Load global config from the first key or just use defaults
    const globalKey = profile.keyConfigs.get('0,0')
    if (globalKey) {
      setGlobalActPt(globalKey.actuationPoint)
      setGlobalSens(globalKey.sensitivity)
      setGlobalRlsSens(globalKey.releaseSensitivity)
      setGlobalMode(globalKey.mode)
    }

    setSocdPairsState(profile.socdPairs)
    setDksConfigsState(profile.okmcConfigs)
  }, [currentProfile, analog.profiles])

  // Measure keyboard widget container and compute scale
  useLayoutEffect(() => {
    const container = kbContainerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      const containerWidth = container.clientWidth - 32 // subtract padding
      let maxX = 0
      for (const k of keys) {
        if (k.x + k.width > maxX) maxX = k.x + k.width
      }
      const naturalWidth = maxX * KEY_UNIT + KEYBOARD_PADDING * 2
      if (naturalWidth > containerWidth && naturalWidth > 0) {
        setKbScale(containerWidth / naturalWidth)
      } else {
        setKbScale(1)
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [activeTab, keys])

  // Debounced save
  const saveTimerRef = useRef<number | null>(null)
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(async () => {
      await api.keychronAnalogSaveProfile(currentProfile)
    }, 1000)
  }, [api, currentProfile])

  // Profile selection
  const handleSelectProfile = useCallback(
    async (index: number) => {
      const ok = await api.keychronAnalogSetProfile(index)
      if (ok) {
        setCurrentProfile(index)
        setSelectedKeys(new Set())
      }
    },
    [api],
  )

  // Rename profile
  const handleStartRename = useCallback(() => {
    setNameInput(profileNames[currentProfile] ?? '')
    setEditingName(true)
  }, [profileNames, currentProfile])

  const handleFinishRename = useCallback(async () => {
    const trimmed = nameInput.trim()
    if (trimmed) {
      const ok = await api.keychronAnalogSetProfileName(currentProfile, trimmed)
      if (ok) {
        setProfileNames((prev) => {
          const next = [...prev]
          next[currentProfile] = trimmed
          return next
        })
      }
    }
    setEditingName(false)
  }, [api, currentProfile, nameInput])

  // Reset profile
  const handleReset = useCallback(async () => {
    const ok = await api.keychronAnalogResetProfile(currentProfile)
    if (ok) {
      // Reload the analog state
      try {
        await api.keychronAnalogReload(rows, cols)
      } catch {
        // ignore
      }
    }
  }, [api, currentProfile, rows, cols])

  // Apply global travel settings
  const handleApplyGlobal = useCallback(async () => {
    const ok = await api.keychronAnalogSetTravel(
      currentProfile,
      globalMode,
      globalActPt,
      globalSens,
      globalRlsSens,
      true, // 'entire' = apply to all keys
    )
    if (ok) scheduleSave()
  }, [api, currentProfile, globalMode, globalActPt, globalSens, globalRlsSens, scheduleSave])

  // Apply to selected keys only
  const handleApplySelected = useCallback(async () => {
    if (selectedKeys.size === 0) return

    // Build row bitmask
    const rowMask = new Array(rows).fill(0)
    for (const key of selectedKeys) {
      const [r, c] = key.split(',').map(Number)
      if (r !== undefined && c !== undefined) {
        rowMask[r] |= 1 << c
      }
    }

    const ok = await api.keychronAnalogSetTravel(
      currentProfile,
      globalMode,
      globalActPt,
      globalSens,
      globalRlsSens,
      false,
      rowMask,
    )
    if (ok) scheduleSave()
  }, [
    api,
    currentProfile,
    globalMode,
    globalActPt,
    globalSens,
    globalRlsSens,
    selectedKeys,
    rows,
    scheduleSave,
  ])

  // Key click for selection
  const handleKeyClick = useCallback(
    (key: KleKey, _maskClicked: boolean, event?: { ctrlKey: boolean; shiftKey: boolean }) => {
      const id = `${key.row},${key.col}`
      setSelectedKeys((prev) => {
        if (event?.ctrlKey || event?.shiftKey) {
          // Toggle with modifier
          const next = new Set(prev)
          if (next.has(id)) {
            next.delete(id)
          } else {
            next.add(id)
          }
          return next
        }
        // Without modifier: select only this key
        return new Set([id])
      })
    },
    [],
  )

  const handleSelectAll = useCallback(() => {
    const all = new Set<string>()
    for (const k of keys) {
      if (k.row !== undefined && k.col !== undefined) {
        all.add(`${k.row},${k.col}`)
      }
    }
    setSelectedKeys(all)
  }, [keys])

  const handleDeselectAll = useCallback(() => {
    setSelectedKeys(new Set())
  }, [])

  // SOCD handlers
  const handleSocdTypeChange = useCallback(
    async (index: number, newType: number) => {
      const pair = socdPairsState[index]
      if (!pair) return

      const ok = await api.keychronAnalogSetSocd(
        currentProfile,
        pair.key1Row,
        pair.key1Col,
        pair.key2Row,
        pair.key2Col,
        index,
        newType,
      )
      if (ok) {
        setSocdPairsState((prev) => {
          const next = [...prev]
          next[index] = { ...pair, type: newType }
          return next
        })
        scheduleSave()
      }
    },
    [api, currentProfile, socdPairsState, scheduleSave],
  )

  // SOCD key-pick: when in pick mode and a keyboard key is clicked
  const handleSocdKeyPick = useCallback(
    async (key: KleKey) => {
      if (!socdPickMode) return
      const { pairIdx, whichKey } = socdPickMode
      const pair = socdPairsState[pairIdx]
      if (!pair) return

      const newPair = { ...pair }
      if (whichKey === 1) {
        newPair.key1Row = key.row ?? 0
        newPair.key1Col = key.col ?? 0
      } else {
        newPair.key2Row = key.row ?? 0
        newPair.key2Col = key.col ?? 0
      }

      const ok = await api.keychronAnalogSetSocd(
        currentProfile,
        newPair.key1Row,
        newPair.key1Col,
        newPair.key2Row,
        newPair.key2Col,
        pairIdx,
        newPair.type,
      )
      if (ok) {
        setSocdPairsState((prev) => {
          const next = [...prev]
          next[pairIdx] = newPair
          return next
        })
        scheduleSave()
      }
      setSocdPickMode(null)
    },
    [socdPickMode, socdPairsState, api, currentProfile, scheduleSave],
  )

  // DKS handlers
  const handleDksConfigChange = useCallback((slot: number, newConfig: OKMCSlotConfig) => {
    setDksConfigsState((prev) => {
      const next = [...prev]
      next[slot] = newConfig
      return next
    })
  }, [])

  const handleApplyDksToSelected = useCallback(async () => {
    if (selectedKeys.size === 0) return
    const cfg = dksConfigsState[activeDksSlot]
    if (!cfg) return

    // Decode events into 4 actions per keycode slot
    const actions: number[] = []

    for (let kc = 0; kc < 4; kc++) {
      const shallowAct = cfg.events[kc * 2] ?? OKMC_ACTION_NONE
      const shallowDeact = cfg.events[kc * 2 + 1] ?? OKMC_ACTION_NONE
      const deepAct = cfg.events[8 + kc * 2] ?? OKMC_ACTION_NONE
      const deepDeact = cfg.events[8 + kc * 2 + 1] ?? OKMC_ACTION_NONE

      // Pack into 2 bytes:
      // byte0 = (shallow_act & 0x0F) | ((shallow_deact & 0x0F) << 4)
      // byte1 = (deep_act & 0x0F) | ((deep_deact & 0x0F) << 4)
      const b0 = (shallowAct & 0x0f) | ((shallowDeact & 0x0f) << 4)
      const b1 = (deepAct & 0x0f) | ((deepDeact & 0x0f) << 4)

      actions.push(b0, b1)
    }

    let allOk = true
    for (const key of selectedKeys) {
      const [r, c] = key.split(',').map(Number)
      if (r !== undefined && c !== undefined) {
        const ok = await api.keychronAnalogSetAdvanceModeDks(
          currentProfile,
          r,
          c,
          activeDksSlot,
          cfg.shallowAct,
          cfg.shallowDeact,
          cfg.deepAct,
          cfg.deepDeact,
          cfg.keycodes,
          actions,
        )
        if (!ok) allOk = false
      }
    }

    if (allOk) {
      scheduleSave()
    }
  }, [selectedKeys, dksConfigsState, activeDksSlot, currentProfile, api, scheduleSave])

  // Game Controller mode
  const handleGcModeChange = useCallback(
    async (mode: number) => {
      const ok = await api.keychronAnalogSetGameControllerMode(mode)
      if (ok) {
        setGcMode(mode)
        scheduleSave()
      }
    },
    [api, scheduleSave],
  )

  const handleCurvePointChange = useCallback((index: number, value: number) => {
    setCurve((prev) => {
      const next = [...prev]
      next[index] = Math.max(0, Math.min(255, value))
      return next
    })
  }, [])

  const handleApplyCurve = useCallback(async () => {
    const ok = await api.keychronAnalogSetCurve(curve)
    if (ok) {
      scheduleSave()
    }
  }, [api, curve, scheduleSave])

  // Calibration
  const handleStartCalibZero = useCallback(async () => {
    const ok = await api.keychronAnalogStartCalibration(CALIB_ZERO_TRAVEL_MANUAL)
    if (ok) {
      setCalibrating(true)
      setCalibPhase('zero')
    }
  }, [api])

  const handleStartCalibFull = useCallback(async () => {
    const ok = await api.keychronAnalogStartCalibration(CALIB_FULL_TRAVEL_MANUAL)
    if (ok) {
      setCalibPhase('full')
    }
  }, [api])

  const handleSaveCalib = useCallback(async () => {
    await api.keychronAnalogStartCalibration(CALIB_SAVE_AND_EXIT)
    setCalibrating(false)
    setCalibPhase('idle')
    setRealtimeTravel(null)
    if (calibIntervalRef.current) {
      window.clearInterval(calibIntervalRef.current)
      calibIntervalRef.current = null
    }
  }, [api])

  const handleCancelCalib = useCallback(async () => {
    setCalibrating(false)
    setCalibPhase('idle')
    setRealtimeTravel(null)
    if (calibIntervalRef.current) {
      window.clearInterval(calibIntervalRef.current)
      calibIntervalRef.current = null
    }
  }, [])

  // Poll realtime travel during calibration
  useEffect(() => {
    if (calibrating && selectedCalibKey) {
      calibIntervalRef.current = window.setInterval(async () => {
        const travel = await api.keychronAnalogGetRealtimeTravel(
          selectedCalibKey.row,
          selectedCalibKey.col,
        )
        if (travel) {
          setRealtimeTravel({
            travelMm: travel.travelMm,
            value: travel.value,
            zero: travel.zero,
            full: travel.full,
          })
        }
      }, 100)

      return () => {
        if (calibIntervalRef.current) {
          window.clearInterval(calibIntervalRef.current)
        }
      }
    }
  }, [calibrating, selectedCalibKey, api])

  const tabBtnClass = (tab: AnalogTab) =>
    `rounded px-3 py-1.5 text-sm font-medium transition-colors ${
      activeTab === tab
        ? 'bg-accent text-on-accent'
        : 'bg-surface-dim text-content-secondary hover:text-content hover:bg-surface'
    }`

  return (
    <div className="flex flex-col gap-4">
      {analog.isDebug && (
        <div className="rounded border border-warning/50 bg-warning/10 p-3 text-sm text-warning-content">
          <strong>Debug Mode Active:</strong> Simulating Keychron HE device. Settings saved will not be written to physical EEPROM.
        </div>
      )}

      {/* Profile selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-content-secondary">
          {t('keychron.analog.profile', 'Profile')}:
        </span>
        <div className="flex gap-1">
          {Array.from({ length: analog.profileCount }, (_, i) => (
            <button
              key={i}
              className={`rounded px-3 py-1 text-sm transition-colors ${
                currentProfile === i
                  ? 'bg-accent text-on-accent'
                  : 'bg-surface-dim text-content-secondary hover:text-content hover:bg-surface'
              }`}
              onClick={() => handleSelectProfile(i)}
            >
              {profileNames[i] || `P${i + 1}`}
            </button>
          ))}
        </div>

        {editingName ? (
          <div className="flex items-center gap-1">
            <input
              className="rounded border border-edge bg-surface px-2 py-0.5 text-sm"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFinishRename()
                if (e.key === 'Escape') setEditingName(false)
              }}
              autoFocus
              maxLength={30}
            />
            <button
              className="rounded border border-edge px-2 py-0.5 text-xs hover:bg-surface-dim"
              onClick={handleFinishRename}
            >
              ✓
            </button>
          </div>
        ) : (
          <button
            className="rounded border border-edge px-2 py-0.5 text-xs text-content-secondary hover:text-content"
            onClick={handleStartRename}
          >
            {t('keychron.analog.rename', 'Rename')}
          </button>
        )}

        <button
          className="ml-auto rounded border border-edge px-2 py-0.5 text-xs text-content-secondary hover:text-content"
          onClick={handleReset}
        >
          {t('keychron.analog.reset', 'Reset Profile')}
        </button>
        <button
          className="rounded border border-edge px-2 py-0.5 text-xs text-content-secondary hover:text-content"
          onClick={() => api.keychronAnalogSaveProfile(currentProfile)}
        >
          {t('keychron.analog.save', 'Save')}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 border-b border-edge pb-2">
        <button className={tabBtnClass('actuation')} onClick={() => setActiveTab('actuation')}>
          {t('keychron.analog.actuation', 'Actuation')}
        </button>
        {analog.okmcCount > 0 && (
          <button className={tabBtnClass('dks')} onClick={() => setActiveTab('dks')}>
            {t('keychron.analog.dks', 'DKS (OKMC)')}
          </button>
        )}
        {analog.socdCount > 0 && (
          <button className={tabBtnClass('socd')} onClick={() => setActiveTab('socd')}>
            {t('keychron.analog.socd', 'SOCD')}
          </button>
        )}
        <button className={tabBtnClass('gamepad')} onClick={() => setActiveTab('gamepad')}>
          {t('keychron.analog.gamepad', 'Gamepad')}
        </button>
        <button className={tabBtnClass('calibration')} onClick={() => setActiveTab('calibration')}>
          {t('keychron.analog.calibration', 'Calibration')}
        </button>
      </div>

      {/* Actuation Tab */}
      {activeTab === 'actuation' && (() => {
        const bottomLabels = new Map<string, string>()
        keys.forEach((key) => {
          const cfg = analog.profiles[currentProfile]?.keyConfigs.get(`${key.row},${key.col}`)
          if (cfg) {
            bottomLabels.set(`${key.row},${key.col}`, `${(cfg.actuationPoint / 10).toFixed(1)}mm`)
          }
        })
        return (
          <div className="flex flex-col gap-4">
            {/* Keyboard visualization */}
            <div ref={kbContainerRef} className="rounded-lg border border-edge bg-surface-dim p-4 flex justify-center overflow-x-hidden">
              <div data-kb-widget>
                <KeyboardWidget
                  keys={keys}
                  keycodes={new Map()}
                  multiSelectedKeys={selectedKeys}
                  onKeyClick={handleKeyClick}
                  bottomLabels={bottomLabels}
                  scale={kbScale}
                />
              </div>
            </div>

          <div className="flex gap-2">
            <button
              className="rounded border border-edge px-2 py-0.5 text-xs text-content-secondary hover:text-content"
              onClick={handleSelectAll}
            >
              {t('keychron.selectAll', 'Select All')}
            </button>
            <button
              className="rounded border border-edge px-2 py-0.5 text-xs text-content-secondary hover:text-content"
              onClick={handleDeselectAll}
            >
              {t('keychron.deselectAll', 'Deselect All')}
            </button>
          </div>

          {/* Global settings */}
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-edge bg-surface p-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-content-secondary">
                {t('keychron.analog.mode', 'Mode')}
              </label>
              <select
                className="rounded border border-edge bg-surface-dim px-2 py-1 text-sm"
                value={globalMode}
                onChange={(e) => setGlobalMode(Number(e.target.value))}
              >
                {Object.entries(AKM_MODE_NAMES)
                  .filter(([k]) => Number(k) <= AKM_RAPID)
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-content-secondary">
                {t('keychron.analog.actuationPoint', 'Actuation Point')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={40}
                  step={1}
                  value={globalActPt}
                  onChange={(e) => setGlobalActPt(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="w-14 text-right text-sm tabular-nums">
                  {(globalActPt / 10).toFixed(1)}mm
                </span>
              </div>
            </div>

            {globalMode === AKM_RAPID && (
              <>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-content-secondary">
                    {t('keychron.analog.sensitivity', 'Press Sensitivity')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={40}
                      step={1}
                      value={globalSens}
                      onChange={(e) => setGlobalSens(Number(e.target.value))}
                      className="flex-1"
                    />
                    <span className="w-14 text-right text-sm tabular-nums">
                      {(globalSens / 10).toFixed(1)}mm
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-content-secondary">
                    {t('keychron.analog.releaseSensitivity', 'Release Sensitivity')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={40}
                      step={1}
                      value={globalRlsSens}
                      onChange={(e) => setGlobalRlsSens(Number(e.target.value))}
                      className="flex-1"
                    />
                    <span className="w-14 text-right text-sm tabular-nums">
                      {(globalRlsSens / 10).toFixed(1)}mm
                    </span>
                  </div>
                </div>
              </>
            )}

            <div className="col-span-2 flex gap-2 pt-2">
              <button
                className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent/90"
                onClick={handleApplyGlobal}
              >
                {t('keychron.analog.applyAll', 'Apply to All Keys')}
              </button>
              <button
                className="rounded border border-accent px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
                onClick={handleApplySelected}
                disabled={selectedKeys.size === 0}
              >
                {t('keychron.analog.applySelected', 'Apply to Selected')} ({selectedKeys.size})
              </button>
            </div>
          </div>

          {/* Selected key info */}
          {selectedKeys.size === 1 &&
            (() => {
              const profile = analog.profiles[currentProfile]
              if (!profile) return null
              const [id] = [...selectedKeys]
              const cfg = profile.keyConfigs.get(id!) as
                | (AnalogKeyConfig & { advMode?: number; advModeData?: number })
                | undefined
              if (!cfg) return null
              return (
                <div className="rounded-lg border border-edge bg-surface p-4">
                  <h4 className="mb-2 text-sm font-medium">
                    {t('keychron.analog.keyInfo', 'Key Info')}: {id}
                  </h4>
                  <div className="grid grid-cols-4 gap-2 text-xs text-content-secondary">
                    <div>
                      Mode:{' '}
                      <span className="text-content">{AKM_MODE_NAMES[cfg.mode] ?? cfg.mode}</span>
                    </div>
                    <div>
                      Act:{' '}
                      <span className="text-content">{(cfg.actuationPoint / 10).toFixed(1)}mm</span>
                    </div>
                    <div>
                      Sens:{' '}
                      <span className="text-content">{(cfg.sensitivity / 10).toFixed(1)}mm</span>
                    </div>
                    <div>
                      Rls:{' '}
                      <span className="text-content">
                        {(cfg.releaseSensitivity / 10).toFixed(1)}mm
                      </span>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        )
      })()}

      {/* DKS Tab */}
      {activeTab === 'dks' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-content-secondary">
            {t(
              'keychron.analog.dksDesc',
              'Dynamic Keystroke (DKS) allows mapping up to 4 keycodes to different travel depths (Shallow Actuation, Deep Actuation, Deep Release, Shallow Release). Assign a DKS slot to analog keys.',
            )}
          </p>

          <div className="flex items-center gap-3">
            <label className="text-sm font-medium">
              {t('keychron.analog.dksSlot', 'DKS Slot')}:
            </label>
            <select
              className="rounded border border-edge bg-surface px-2 py-1 text-sm font-mono"
              value={activeDksSlot}
              onChange={(e) => setActiveDksSlot(Number(e.target.value))}
            >
              {dksConfigsState.map((_, i) => (
                <option key={i} value={i}>
                  Slot {i}
                </option>
              ))}
            </select>
          </div>

          {dksConfigsState[activeDksSlot] &&
            (() => {
              const cfg = dksConfigsState[activeDksSlot]!
              const updateCfg = (newCfg: Partial<OKMCSlotConfig>) => {
                handleDksConfigChange(activeDksSlot, { ...cfg, ...newCfg })
              }

              return (
                <div className="flex flex-col gap-4 rounded-lg border border-edge bg-surface p-4">
                  <div className="grid grid-cols-4 gap-4">
                    {/* Travel thresholds */}
                    {[
                      { key: 'shallowAct', label: 'Shallow Press' },
                      { key: 'deepAct', label: 'Deep Press' },
                      { key: 'deepDeact', label: 'Deep Release' },
                      { key: 'shallowDeact', label: 'Shallow Release' },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-content-secondary">
                          {label}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={40}
                            className="w-16 rounded border border-edge bg-surface-dim px-2 py-1 text-sm"
                            value={cfg[key as keyof OKMCSlotConfig] as number}
                            onChange={(e) => updateCfg({ [key]: Number(e.target.value) })}
                          />
                          <span className="text-xs text-content-secondary">
                            {((cfg[key as keyof OKMCSlotConfig] as number) / 10).toFixed(1)}mm
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-edge text-content-secondary">
                          <th className="pb-2 font-medium">Keycode</th>
                          <th className="pb-2 font-medium">Shallow Press</th>
                          <th className="pb-2 font-medium">Deep Press</th>
                          <th className="pb-2 font-medium">Deep Release</th>
                          <th className="pb-2 font-medium">Shallow Release</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[0, 1, 2, 3].map((kcIdx) => (
                          <tr key={kcIdx} className="border-b border-edge/50 last:border-0">
                            <td className="py-2">
                              <input
                                className="w-24 rounded border border-edge bg-surface-dim px-2 py-1 text-sm font-mono"
                                value={`0x${cfg.keycodes[kcIdx]?.toString(16).padStart(4, '0')}`}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 16)
                                  if (!isNaN(val)) {
                                    const keycodes = [...cfg.keycodes]
                                    keycodes[kcIdx] = val
                                    updateCfg({ keycodes })
                                  }
                                }}
                                title="Enter hexadecimal keycode (e.g., 0x0004 for A)"
                              />
                            </td>
                            {[
                              { eventIdx: kcIdx * 2 }, // shallow act
                              { eventIdx: 8 + kcIdx * 2 }, // deep act
                              { eventIdx: 8 + kcIdx * 2 + 1 }, // deep deact
                              { eventIdx: kcIdx * 2 + 1 }, // shallow deact
                            ].map(({ eventIdx }, colIdx) => (
                              <td key={colIdx} className="py-2 pr-2">
                                <select
                                  className="w-full max-w-[140px] rounded border border-edge bg-surface-dim px-1.5 py-1 text-xs"
                                  value={cfg.events[eventIdx] ?? OKMC_ACTION_NONE}
                                  onChange={(e) => {
                                    const events = [...cfg.events]
                                    events[eventIdx] = Number(e.target.value)
                                    updateCfg({ events })
                                  }}
                                >
                                  {Object.entries(OKMC_ACTION_NAMES).map(([val, name]) => (
                                    <option key={val} value={val}>
                                      {name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })()}

          <div className="flex flex-col gap-2 pt-2">
            <div ref={kbContainerRef} className="rounded-lg border border-edge bg-surface-dim p-4 flex justify-center overflow-x-hidden">
              <div data-kb-widget>
                <KeyboardWidget
                  keys={keys}
                  keycodes={new Map()}
                  multiSelectedKeys={selectedKeys}
                  onKeyClick={handleKeyClick}
                  scale={kbScale}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded border border-edge px-2 py-0.5 text-xs text-content-secondary hover:text-content"
                onClick={handleSelectAll}
              >
                {t('keychron.selectAll', 'Select All')}
              </button>
              <button
                className="rounded border border-edge px-2 py-0.5 text-xs text-content-secondary hover:text-content"
                onClick={handleDeselectAll}
              >
                {t('keychron.deselectAll', 'Deselect All')}
              </button>
              <div className="ml-auto flex gap-2">
                <button
                  className="rounded border border-edge px-4 py-1.5 text-sm font-medium hover:bg-surface-dim disabled:opacity-40"
                  onClick={async () => {
                    if (selectedKeys.size === 0) return
                    let allOk = true
                    for (const key of selectedKeys) {
                      const [r, c] = key.split(',').map(Number)
                      if (r !== undefined && c !== undefined) {
                        const ok = await api.keychronAnalogSetAdvanceModeClear(currentProfile, r, c)
                        if (!ok) allOk = false
                      }
                    }
                    if (allOk) scheduleSave()
                  }}
                  disabled={selectedKeys.size === 0}
                  title="Remove DKS/Gamepad/Toggle bindings from selected keys"
                >
                  {t('keychron.analog.clearAdvance', 'Clear Mode')}
                </button>
                <button
                  className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:opacity-40"
                  onClick={handleApplyDksToSelected}
                  disabled={selectedKeys.size === 0}
                >
                  {t('keychron.analog.assignDks', 'Assign DKS to Selected')} ({selectedKeys.size})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SOCD Tab */}
      {activeTab === 'socd' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-content-secondary">
            {t(
              'keychron.analog.socdDesc',
              'Configure Simultaneous Opposite Cardinal Direction (SOCD) key pairs. When both keys in a pair are pressed, the selected resolution mode determines which key takes priority.',
            )}
          </p>

          {/* Show keyboard widget when in pick mode */}
          {socdPickMode && (
            <div ref={kbContainerRef} className="rounded-lg border-2 border-accent bg-surface-dim p-4 flex flex-col items-center overflow-x-hidden">
              <p className="mb-2 text-sm font-medium text-accent self-start">
                Click a key on the keyboard to assign it as Key {socdPickMode.whichKey} for SOCD
                pair #{socdPickMode.pairIdx + 1}
              </p>
              <div data-kb-widget>
                <KeyboardWidget
                  keys={keys}
                  keycodes={new Map()}
                  multiSelectedKeys={new Set()}
                  onKeyClick={(key) => handleSocdKeyPick(key)}
                  customLabels={(() => {
                    const labels = new Map<string, string>()
                    keys.forEach((k) => {
                      if (k.row !== undefined && k.col !== undefined) {
                        const posKey = `0,${k.row},${k.col}`
                        const code = keymap.get(posKey) ?? 0
                        
                        if (code) {
                          labels.set(`${k.row},${k.col}`, codeToLabel(code))
                        }
                      }
                    })
                    return labels
                  })()}
                  scale={kbScale}
                />
              </div>
              <button
                className="mt-2 rounded border border-edge px-3 py-1 text-xs text-content-secondary hover:text-content"
                onClick={() => setSocdPickMode(null)}
              >
                Cancel
              </button>
            </div>
          )}

          {socdPairsState.length === 0 ? (
            <p className="text-sm text-content-secondary italic">
              {t('keychron.analog.noSocd', 'No SOCD slots available for this keyboard.')}
            </p>
          ) : (
            <div className="space-y-2">
              {socdPairsState.map((pair, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-edge bg-surface p-3 flex-wrap"
                >
                  <span className="text-xs font-medium text-content-secondary w-8">#{i + 1}</span>
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      className={`rounded px-2 py-0.5 border transition-colors ${
                        socdPickMode?.pairIdx === i && socdPickMode?.whichKey === 1
                          ? 'bg-accent text-on-accent border-accent'
                          : 'bg-surface-dim border-edge hover:border-accent hover:text-accent'
                      }`}
                      onClick={() => setSocdPickMode({ pairIdx: i, whichKey: 1 })}
                      title="Click to assign Key 1"
                    >
                      R{pair.key1Row}C{pair.key1Col}
                      {keymap.has(`0,${pair.key1Row},${pair.key1Col}`) && (
                        <span className="ml-1 opacity-70">
                          ({codeToLabel(keymap.get(`0,${pair.key1Row},${pair.key1Col}`)!)})
                        </span>
                      )}
                    </button>
                    <span className="text-content-secondary">↔</span>
                    <button
                      className={`rounded px-2 py-0.5 border transition-colors ${
                        socdPickMode?.pairIdx === i && socdPickMode?.whichKey === 2
                          ? 'bg-accent text-on-accent border-accent'
                          : 'bg-surface-dim border-edge hover:border-accent hover:text-accent'
                      }`}
                      onClick={() => setSocdPickMode({ pairIdx: i, whichKey: 2 })}
                      title="Click to assign Key 2"
                    >
                      R{pair.key2Row}C{pair.key2Col}
                      {keymap.has(`0,${pair.key2Row},${pair.key2Col}`) && (
                        <span className="ml-1 opacity-70">
                          ({codeToLabel(keymap.get(`0,${pair.key2Row},${pair.key2Col}`)!)})
                        </span>
                      )}
                    </button>
                  </div>
                  <select
                    className="ml-auto rounded border border-edge bg-surface-dim px-2 py-1 text-sm"
                    value={pair.type}
                    onChange={(e) => handleSocdTypeChange(i, Number(e.target.value))}
                  >
                    {Object.entries(SOCD_TYPE_NAMES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Gamepad Tab */}
      {activeTab === 'gamepad' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-content-secondary">
            {t(
              'keychron.analog.gamepadDesc',
              'Configure Game Controller mode. When enabled, analog keys can act as gamepad axes or buttons.',
            )}
          </p>
          <div className="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={!!(gcMode & GC_MASK_XINPUT)}
                onChange={(e) =>
                  handleGcModeChange(
                    e.target.checked ? gcMode | GC_MASK_XINPUT : gcMode & ~GC_MASK_XINPUT,
                  )
                }
                className="h-4 w-4 rounded border-edge"
              />
              <span className="text-sm">{t('keychron.analog.xinput', 'XInput Mode')}</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={!!(gcMode & GC_MASK_TYPING)}
                onChange={(e) =>
                  handleGcModeChange(
                    e.target.checked ? gcMode | GC_MASK_TYPING : gcMode & ~GC_MASK_TYPING,
                  )
                }
                className="h-4 w-4 rounded border-edge"
              />
              <span className="text-sm">
                {t(
                  'keychron.analog.keepTyping',
                  'Keep Typing Mode (send keypresses alongside gamepad)',
                )}
              </span>
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-edge bg-surface p-4">
            <h4 className="text-sm font-medium">
              {t('keychron.analog.joystickCurve', 'Joystick Response Curve')}
            </h4>
            <div className="grid grid-cols-2 gap-4">
              {[0, 1, 2, 3].map((ptIndex) => (
                <div key={ptIndex} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-content-secondary">
                    Point {ptIndex + 1}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs">X:</span>
                    <input
                      type="number"
                      min={0}
                      max={255}
                      className="w-16 rounded border border-edge bg-surface-dim px-2 py-0.5 text-sm"
                      value={curve[ptIndex * 2] ?? 0}
                      onChange={(e) => handleCurvePointChange(ptIndex * 2, Number(e.target.value))}
                    />
                    <span className="text-xs">Y:</span>
                    <input
                      type="number"
                      min={0}
                      max={255}
                      className="w-16 rounded border border-edge bg-surface-dim px-2 py-0.5 text-sm"
                      value={curve[ptIndex * 2 + 1] ?? 0}
                      onChange={(e) =>
                        handleCurvePointChange(ptIndex * 2 + 1, Number(e.target.value))
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              className="mt-2 self-start rounded border border-edge bg-surface-dim px-3 py-1.5 text-sm font-medium hover:bg-surface-elevated transition-colors"
              onClick={handleApplyCurve}
            >
              {t('keychron.analog.applyCurve', 'Apply Curve')}
            </button>
          </div>
        </div>
      )}

      {/* Calibration Tab */}
      {activeTab === 'calibration' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-content-secondary">
            {t(
              'keychron.analog.calibDesc',
              'Calibrate the Hall Effect sensors. First calibrate the zero (rest) position, then the full travel position.',
            )}
          </p>

          {!calibrating ? (
            <div className="flex gap-2">
              <button
                className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent/90"
                onClick={handleStartCalibZero}
              >
                {t('keychron.analog.calibStart', 'Start Calibration')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 rounded-lg border border-edge bg-surface p-4">
              <div className="text-sm">
                <span className="font-medium">Phase: </span>
                <span className={calibPhase === 'zero' ? 'text-yellow-500' : 'text-green-500'}>
                  {calibPhase === 'zero'
                    ? t('keychron.analog.calibZero', 'Zero Travel (do NOT press any keys)')
                    : t('keychron.analog.calibFull', 'Full Travel (press each key fully)')}
                </span>
              </div>

              {/* Key selector for realtime monitoring */}
              <div className="flex items-center gap-2">
                <label className="text-sm text-content-secondary">
                  {t('keychron.analog.monitorKey', 'Monitor Key')}:
                </label>
                <input
                  type="number"
                  min={0}
                  max={rows - 1}
                  className="w-16 rounded border border-edge bg-surface-dim px-2 py-0.5 text-sm"
                  placeholder="Row"
                  onChange={(e) =>
                    setSelectedCalibKey((prev) => ({
                      row: Number(e.target.value),
                      col: prev?.col ?? 0,
                    }))
                  }
                />
                <input
                  type="number"
                  min={0}
                  max={cols - 1}
                  className="w-16 rounded border border-edge bg-surface-dim px-2 py-0.5 text-sm"
                  placeholder="Col"
                  onChange={(e) =>
                    setSelectedCalibKey((prev) => ({
                      row: prev?.row ?? 0,
                      col: Number(e.target.value),
                    }))
                  }
                />
              </div>

              {/* Realtime travel display */}
              {realtimeTravel && (
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="rounded bg-surface-dim p-2 text-center">
                    <div className="text-content-secondary">Travel</div>
                    <div className="text-lg font-mono">
                      {(realtimeTravel.travelMm / 10).toFixed(1)}mm
                    </div>
                  </div>
                  <div className="rounded bg-surface-dim p-2 text-center">
                    <div className="text-content-secondary">Value</div>
                    <div className="text-lg font-mono">{realtimeTravel.value}</div>
                  </div>
                  <div className="rounded bg-surface-dim p-2 text-center">
                    <div className="text-content-secondary">Zero</div>
                    <div className="text-lg font-mono">{realtimeTravel.zero}</div>
                  </div>
                  <div className="rounded bg-surface-dim p-2 text-center">
                    <div className="text-content-secondary">Full</div>
                    <div className="text-lg font-mono">{realtimeTravel.full}</div>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {calibPhase === 'zero' && (
                  <button
                    className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent/90"
                    onClick={handleStartCalibFull}
                  >
                    {t('keychron.analog.calibNext', 'Next: Full Travel')}
                  </button>
                )}
                {calibPhase === 'full' && (
                  <button
                    className="rounded bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                    onClick={handleSaveCalib}
                  >
                    {t('keychron.analog.calibSave', 'Save Calibration')}
                  </button>
                )}
                <button
                  className="rounded border border-edge px-4 py-1.5 text-sm text-content-secondary hover:text-content"
                  onClick={handleCancelCalib}
                >
                  {t('keychron.analog.calibCancel', 'Cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Version info */}
      <div className="mt-2 text-xs text-content-secondary">
        {t('keychron.analog.version', 'Analog v{{version}}', { version: analog.version })} •{' '}
        {analog.profileCount} {t('keychron.analog.profiles', 'profiles')} • {analog.okmcCount} DKS •{' '}
        {analog.socdCount} SOCD
      </div>
    </div>
  )
}
