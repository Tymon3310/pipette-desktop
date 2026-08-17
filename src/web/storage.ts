// SPDX-License-Identifier: GPL-2.0-or-later
// In-browser Storage Layer using LocalStorage and IndexedDB

import type { SnapshotMeta } from '../shared/types/snapshot-store'
import type { AnalyzeFilterSnapshotMeta } from '../shared/types/analyze-filter-store'
import type { SavedFavoriteMeta, FavoriteImportResult } from '../shared/types/favorite-store'
import type { KeyLabelMeta, KeyLabelRecord, KeyLabelStoreResult, KeyLabelImportBatchResult } from '../shared/types/key-label-store'
import type { TypingTestTextMeta, TypingTestTextRecord, TypingTestTextStoreResult } from '../shared/types/typing-test-text-store'
import type { I18nPackMeta, I18nPackRecord, I18nPackStoreResult } from '../shared/types/i18n-store'
import type { ThemePackMeta, ThemePackRecord, ThemePackStoreResult } from '../shared/types/theme-store'
import { DEFAULT_APP_CONFIG, type AppConfig } from '../shared/types/app-config'
import type { PipetteSettings, PipetteSettingsPatch, PooledTypingTestResult } from '../shared/types/pipette-settings'
import type { RunKeystrokeLog, RunLogMeta } from '../shared/types/typing-run-log'
import type { StoredKeyboardInfo } from '../shared/types/sync'

const APP_CONFIG_KEY = 'pipette_app_config'
const KEYBOARD_META_PREFIX = 'pipette_keyboard_meta_'
const SETTINGS_PREFIX = 'pipette_settings_'
const SNAPSHOTS_PREFIX = 'pipette_snapshots_'
const FILTERS_PREFIX = 'pipette_analyze_filters_'
const FAVORITES_PREFIX = 'pipette_favorites_'
const KEY_LABELS_KEY = 'pipette_key_labels'
const TYPING_TESTS_KEY = 'pipette_typing_test_texts'
const I18N_PACKS_KEY = 'pipette_i18n_packs'
const THEME_PACKS_KEY = 'pipette_theme_packs'
const RUN_LOGS_PREFIX = 'pipette_run_logs_'

function getJson<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return defaultValue
    return JSON.parse(raw) as T
  } catch {
    return defaultValue
  }
}

function setJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.warn(`Failed to set localStorage key "${key}":`, err)
  }
}

// --- App Config ---
export async function appConfigGetAll(): Promise<AppConfig> {
  return { ...DEFAULT_APP_CONFIG, ...getJson<Partial<AppConfig>>(APP_CONFIG_KEY, {}) }
}

export async function appConfigSet(key: string, value: unknown): Promise<void> {
  const current = await appConfigGetAll()
  ;(current as Record<string, unknown>)[key] = value
  setJson(APP_CONFIG_KEY, current)
}

// --- Pipette Settings ---
export async function pipetteSettingsGet(uid: string): Promise<PipetteSettings | null> {
  return getJson<PipetteSettings | null>(`${SETTINGS_PREFIX}${uid}`, null)
}

export async function pipetteSettingsPatch(uid: string, partial: PipetteSettingsPatch): Promise<{ success: boolean; error?: string }> {
  try {
    const current = (await pipetteSettingsGet(uid)) || {}
    const updated = { ...current, ...partial }
    setJson(`${SETTINGS_PREFIX}${uid}`, updated)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function pipetteSettingsListAllTypingResults(): Promise<PooledTypingTestResult[]> {
  const results: PooledTypingTestResult[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(SETTINGS_PREFIX)) {
        const uid = key.substring(SETTINGS_PREFIX.length)
        const settings = getJson<PipetteSettings | null>(key, null)
        const keyboardName = localStorage.getItem(`${KEYBOARD_META_PREFIX}${uid}`) || 'Unknown Keyboard'
        if (settings?.typingTestResults) {
          for (const item of settings.typingTestResults) {
            results.push({
              ...item,
              keyboardName,
              keyboardUid: uid,
            } as unknown as PooledTypingTestResult)
          }
        }
      }
    }
  } catch (err) {
    console.warn('Failed to list pooled typing results:', err)
  }
  return results
}

// --- Keyboard Metadata ---
export async function keyboardMetaNameIfMissing(uid: string, name: string): Promise<void> {
  if (!uid || !name) return
  const key = `${KEYBOARD_META_PREFIX}${uid}`
  if (!localStorage.getItem(key)) {
    localStorage.setItem(key, name)
  }
}

export async function listStoredKeyboards(): Promise<StoredKeyboardInfo[]> {
  const keyboards: StoredKeyboardInfo[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(KEYBOARD_META_PREFIX)) {
      const uid = key.substring(KEYBOARD_META_PREFIX.length)
      const name = localStorage.getItem(key) || 'Keyboard'
      keyboards.push({ uid, name })
    }
  }
  return keyboards
}

// --- Snapshot Store ---
interface StoredSnapshot {
  meta: SnapshotMeta
  json: string
}

export async function snapshotStoreList(uid: string): Promise<{ success: boolean; entries?: SnapshotMeta[]; error?: string }> {
  const items = getJson<StoredSnapshot[]>(`${SNAPSHOTS_PREFIX}${uid}`, [])
  return { success: true, entries: items.map((i) => i.meta) }
}

export async function snapshotStoreSave(
  uid: string,
  json: string,
  deviceName: string,
  label: string,
  vilVersion?: number,
): Promise<{ success: boolean; entry?: SnapshotMeta; error?: string }> {
  try {
    const items = getJson<StoredSnapshot[]>(`${SNAPSHOTS_PREFIX}${uid}`, [])
    const entry: SnapshotMeta = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      uid,
      deviceName,
      label,
      vilVersion: vilVersion ?? 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    items.unshift({ meta: entry, json })
    setJson(`${SNAPSHOTS_PREFIX}${uid}`, items)
    return { success: true, entry }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function snapshotStoreLoad(uid: string, entryId: string): Promise<{ success: boolean; data?: string; error?: string }> {
  const items = getJson<StoredSnapshot[]>(`${SNAPSHOTS_PREFIX}${uid}`, [])
  const found = items.find((i) => i.meta.id === entryId)
  if (!found) return { success: false, error: 'Snapshot not found' }
  return { success: true, data: found.json }
}

export async function snapshotStoreUpdate(uid: string, entryId: string, json: string, vilVersion?: number): Promise<{ success: boolean; error?: string }> {
  const items = getJson<StoredSnapshot[]>(`${SNAPSHOTS_PREFIX}${uid}`, [])
  const idx = items.findIndex((i) => i.meta.id === entryId)
  if (idx === -1) return { success: false, error: 'Snapshot not found' }
  items[idx].json = json
  items[idx].meta.updatedAt = new Date().toISOString()
  if (vilVersion !== undefined) items[idx].meta.vilVersion = vilVersion
  setJson(`${SNAPSHOTS_PREFIX}${uid}`, items)
  return { success: true }
}

export async function snapshotStoreRename(uid: string, entryId: string, newLabel: string): Promise<{ success: boolean; error?: string }> {
  const items = getJson<StoredSnapshot[]>(`${SNAPSHOTS_PREFIX}${uid}`, [])
  const idx = items.findIndex((i) => i.meta.id === entryId)
  if (idx === -1) return { success: false, error: 'Snapshot not found' }
  items[idx].meta.label = newLabel
  items[idx].meta.updatedAt = new Date().toISOString()
  setJson(`${SNAPSHOTS_PREFIX}${uid}`, items)
  return { success: true }
}

export async function snapshotStoreDelete(uid: string, entryId: string): Promise<{ success: boolean; error?: string }> {
  const items = getJson<StoredSnapshot[]>(`${SNAPSHOTS_PREFIX}${uid}`, [])
  const filtered = items.filter((i) => i.meta.id !== entryId)
  setJson(`${SNAPSHOTS_PREFIX}${uid}`, filtered)
  return { success: true }
}

// --- Analyze Filter Store ---
interface StoredAnalyzeFilter {
  meta: AnalyzeFilterSnapshotMeta
  json: string
}

export async function analyzeFilterStoreList(uid: string): Promise<{ success: boolean; entries?: AnalyzeFilterSnapshotMeta[]; error?: string }> {
  const items = getJson<StoredAnalyzeFilter[]>(`${FILTERS_PREFIX}${uid}`, [])
  return { success: true, entries: items.map((i) => i.meta) }
}

export async function analyzeFilterStoreSave(
  uid: string,
  json: string,
  label: string,
  summary?: string,
): Promise<{ success: boolean; entry?: AnalyzeFilterSnapshotMeta; error?: string }> {
  try {
    const items = getJson<StoredAnalyzeFilter[]>(`${FILTERS_PREFIX}${uid}`, [])
    const entry: AnalyzeFilterSnapshotMeta = {
      id: `filter_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      uid,
      label,
      summary,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    items.unshift({ meta: entry, json })
    setJson(`${FILTERS_PREFIX}${uid}`, items)
    return { success: true, entry }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function analyzeFilterStoreLoad(uid: string, entryId: string): Promise<{ success: boolean; data?: string; error?: string }> {
  const items = getJson<StoredAnalyzeFilter[]>(`${FILTERS_PREFIX}${uid}`, [])
  const found = items.find((i) => i.meta.id === entryId)
  if (!found) return { success: false, error: 'Filter not found' }
  return { success: true, data: found.json }
}

export async function analyzeFilterStoreUpdate(uid: string, entryId: string, json: string): Promise<{ success: boolean; error?: string }> {
  const items = getJson<StoredAnalyzeFilter[]>(`${FILTERS_PREFIX}${uid}`, [])
  const idx = items.findIndex((i) => i.meta.id === entryId)
  if (idx === -1) return { success: false, error: 'Filter not found' }
  items[idx].json = json
  items[idx].meta.updatedAt = new Date().toISOString()
  setJson(`${FILTERS_PREFIX}${uid}`, items)
  return { success: true }
}

export async function analyzeFilterStoreRename(uid: string, entryId: string, newLabel: string): Promise<{ success: boolean; error?: string }> {
  const items = getJson<StoredAnalyzeFilter[]>(`${FILTERS_PREFIX}${uid}`, [])
  const idx = items.findIndex((i) => i.meta.id === entryId)
  if (idx === -1) return { success: false, error: 'Filter not found' }
  items[idx].meta.label = newLabel
  items[idx].meta.updatedAt = new Date().toISOString()
  setJson(`${FILTERS_PREFIX}${uid}`, items)
  return { success: true }
}

export async function analyzeFilterStoreDelete(uid: string, entryId: string): Promise<{ success: boolean; error?: string }> {
  const items = getJson<StoredAnalyzeFilter[]>(`${FILTERS_PREFIX}${uid}`, [])
  const filtered = items.filter((i) => i.meta.id !== entryId)
  setJson(`${FILTERS_PREFIX}${uid}`, filtered)
  return { success: true }
}

// --- Favorite Store ---
interface StoredFavorite {
  meta: SavedFavoriteMeta
  json: string
}

export async function favoriteStoreList(type: string): Promise<{ success: boolean; entries?: SavedFavoriteMeta[]; error?: string }> {
  const items = getJson<StoredFavorite[]>(`${FAVORITES_PREFIX}${type}`, [])
  return { success: true, entries: items.map((i) => i.meta) }
}

export async function favoriteStoreSave(type: string, json: string, label: string): Promise<{ success: boolean; entry?: SavedFavoriteMeta; error?: string }> {
  try {
    const items = getJson<StoredFavorite[]>(`${FAVORITES_PREFIX}${type}`, [])
    const entry: SavedFavoriteMeta = {
      id: `fav_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: type as any,
      label,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    items.unshift({ meta: entry, json })
    setJson(`${FAVORITES_PREFIX}${type}`, items)
    return { success: true, entry }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function favoriteStoreLoad(type: string, entryId: string): Promise<{ success: boolean; data?: string; error?: string }> {
  const items = getJson<StoredFavorite[]>(`${FAVORITES_PREFIX}${type}`, [])
  const found = items.find((i) => i.meta.id === entryId)
  if (!found) return { success: false, error: 'Favorite not found' }
  return { success: true, data: found.json }
}

export async function favoriteStoreRename(type: string, entryId: string, newLabel: string): Promise<{ success: boolean; error?: string }> {
  const items = getJson<StoredFavorite[]>(`${FAVORITES_PREFIX}${type}`, [])
  const idx = items.findIndex((i) => i.meta.id === entryId)
  if (idx === -1) return { success: false, error: 'Favorite not found' }
  items[idx].meta.label = newLabel
  items[idx].meta.updatedAt = new Date().toISOString()
  setJson(`${FAVORITES_PREFIX}${type}`, items)
  return { success: true }
}

export async function favoriteStoreDelete(type: string, entryId: string): Promise<{ success: boolean; error?: string }> {
  const items = getJson<StoredFavorite[]>(`${FAVORITES_PREFIX}${type}`, [])
  const filtered = items.filter((i) => i.meta.id !== entryId)
  setJson(`${FAVORITES_PREFIX}${type}`, filtered)
  return { success: true }
}

// --- Key Label Store ---
export async function keyLabelStoreList(): Promise<KeyLabelStoreResult<KeyLabelMeta[]>> {
  const records = getJson<KeyLabelRecord[]>(KEY_LABELS_KEY, [])
  return { success: true, data: records.map((r) => r.meta) }
}

export async function keyLabelStoreGet(id: string): Promise<KeyLabelStoreResult<KeyLabelRecord>> {
  const records = getJson<KeyLabelRecord[]>(KEY_LABELS_KEY, [])
  const found = records.find((r) => r.meta.id === id)
  if (!found) return { success: false, error: 'Key label set not found' }
  return { success: true, data: found }
}

export async function keyLabelStoreRename(id: string, newName: string): Promise<KeyLabelStoreResult<KeyLabelMeta>> {
  const records = getJson<KeyLabelRecord[]>(KEY_LABELS_KEY, [])
  const found = records.find((r) => r.meta.id === id)
  if (!found) return { success: false, error: 'Key label set not found' }
  found.meta.name = newName
  found.meta.updatedAt = new Date().toISOString()
  setJson(KEY_LABELS_KEY, records)
  return { success: true, data: found.meta }
}

export async function keyLabelStoreDelete(id: string): Promise<KeyLabelStoreResult<void>> {
  const records = getJson<KeyLabelRecord[]>(KEY_LABELS_KEY, [])
  const filtered = records.filter((r) => r.meta.id !== id)
  setJson(KEY_LABELS_KEY, filtered)
  return { success: true }
}

export async function keyLabelStoreReorder(orderedIds: string[]): Promise<KeyLabelStoreResult<void>> {
  const records = getJson<KeyLabelRecord[]>(KEY_LABELS_KEY, [])
  const map = new Map(records.map((r) => [r.meta.id, r]))
  const reordered: KeyLabelRecord[] = []
  for (const id of orderedIds) {
    const item = map.get(id)
    if (item) reordered.push(item)
  }
  for (const r of records) {
    if (!orderedIds.includes(r.meta.id)) reordered.push(r)
  }
  setJson(KEY_LABELS_KEY, reordered)
  return { success: true }
}

// --- Typing Test Text Store ---
export async function typingTestTextStoreList(): Promise<TypingTestTextStoreResult<TypingTestTextMeta[]>> {
  const records = getJson<TypingTestTextRecord[]>(TYPING_TESTS_KEY, [])
  return { success: true, data: records.map((r) => r.meta) }
}

export async function typingTestTextStoreGet(id: string): Promise<TypingTestTextStoreResult<TypingTestTextRecord>> {
  const records = getJson<TypingTestTextRecord[]>(TYPING_TESTS_KEY, [])
  const found = records.find((r) => r.meta.id === id)
  if (!found) return { success: false, error: 'Typing test text not found' }
  return { success: true, data: found }
}

export async function typingTestTextStoreRename(id: string, newName: string): Promise<TypingTestTextStoreResult<TypingTestTextMeta>> {
  const records = getJson<TypingTestTextRecord[]>(TYPING_TESTS_KEY, [])
  const found = records.find((r) => r.meta.id === id)
  if (!found) return { success: false, error: 'Typing test text not found' }
  found.meta.name = newName
  found.meta.updatedAt = new Date().toISOString()
  setJson(TYPING_TESTS_KEY, records)
  return { success: true, data: found.meta }
}

export async function typingTestTextStoreDelete(id: string): Promise<TypingTestTextStoreResult<void>> {
  const records = getJson<TypingTestTextRecord[]>(TYPING_TESTS_KEY, [])
  const filtered = records.filter((r) => r.meta.id !== id)
  setJson(TYPING_TESTS_KEY, filtered)
  return { success: true }
}

// --- i18n & Theme Pack Stores ---
export async function i18nPackList(): Promise<I18nPackStoreResult<I18nPackMeta[]>> {
  const records = getJson<I18nPackRecord[]>(I18N_PACKS_KEY, [])
  return { success: true, data: records.map((r) => r.meta) }
}

export async function i18nPackGet(id: string): Promise<I18nPackStoreResult<I18nPackRecord>> {
  const records = getJson<I18nPackRecord[]>(I18N_PACKS_KEY, [])
  const found = records.find((r) => r.meta.id === id)
  if (!found) return { success: false, error: 'Pack not found' }
  return { success: true, data: found }
}

export async function themePackList(): Promise<ThemePackStoreResult<ThemePackMeta[]>> {
  const records = getJson<ThemePackRecord[]>(THEME_PACKS_KEY, [])
  return { success: true, data: records.map((r) => r.meta) }
}

export async function themePackGet(id: string): Promise<ThemePackStoreResult<ThemePackRecord>> {
  const records = getJson<ThemePackRecord[]>(THEME_PACKS_KEY, [])
  const found = records.find((r) => r.meta.id === id)
  if (!found) return { success: false, error: 'Theme pack not found' }
  return { success: true, data: found }
}

// --- Typing Run Log Store ---
interface StoredRunLog {
  meta: RunLogMeta
  log: RunKeystrokeLog
}

export async function typingRunLogSave(uid: string, log: RunKeystrokeLog): Promise<{ success: boolean; entry?: RunLogMeta; error?: string }> {
  try {
    const key = `${RUN_LOGS_PREFIX}${uid}`
    const items = getJson<StoredRunLog[]>(key, [])
    const meta: RunLogMeta = {
      runId: log.runId || `run_${Date.now()}`,
      uid,
      startedAt: log.startedAt || new Date().toISOString(),
      keystrokeCount: log.keystrokes?.length || 0,
    }
    items.unshift({ meta, log })
    // Keep last 50 runs in local storage to prevent quota overflow
    if (items.length > 50) items.length = 50
    setJson(key, items)
    return { success: true, entry: meta }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function typingRunLogList(uid: string): Promise<{ success: boolean; entries?: RunLogMeta[]; error?: string }> {
  const items = getJson<StoredRunLog[]>(`${RUN_LOGS_PREFIX}${uid}`, [])
  return { success: true, entries: items.map((i) => i.meta) }
}

export async function typingRunLogGet(uid: string, runId: string): Promise<{ success: boolean; data?: RunKeystrokeLog; error?: string }> {
  const items = getJson<StoredRunLog[]>(`${RUN_LOGS_PREFIX}${uid}`, [])
  const found = items.find((i) => i.meta.runId === runId)
  if (!found) return { success: false, error: 'Run log not found' }
  return { success: true, data: found.log }
}
