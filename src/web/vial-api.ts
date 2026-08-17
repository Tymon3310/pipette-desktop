// SPDX-License-Identifier: GPL-2.0-or-later
// In-browser implementation of VialAPI for Pipette Web

import type { VialAPI, TrayStatus } from '../shared/types/vial-api'
import type { DeviceInfo, KeyboardDefinition, KeyboardId, ProbeResult } from '../shared/types/protocol'
import * as protocol from '../preload/protocol'
import * as keychronProtocol from '../preload/keychron-protocol'
import * as webHid from './hid-transport'
import * as webStorage from './storage'
import * as webFileIo from './file-io'
import { decompressDefinition } from './lzma'
import { requestAndFlashWebDfu } from './dfu'

const dfuListeners = new Set<(data: { log?: string; progress?: number }) => void>()

export function createWebVialAPI(): VialAPI {
  // Ensure WebHID transport is initialized for protocol modules
  webHid.initWebTransport()

  return {
    // --- Device Management ---
    listDevices: (): Promise<DeviceInfo[]> => webHid.listDevices(),
    requestDevice: (): Promise<DeviceInfo | null> => webHid.requestDevice(),
    openDevice: (vendorId: number, productId: number, serialNumber?: string): Promise<boolean> =>
      webHid.openHidDevice(vendorId, productId, serialNumber),
    closeDevice: (): Promise<void> => webHid.closeHidDevice(),
    isDeviceOpen: (): Promise<boolean> => webHid.isDeviceOpen(),
    probeDevice: (vendorId: number, productId: number, serialNumber?: string): Promise<ProbeResult> =>
      webHid.probeDevice(vendorId, productId, serialNumber),

    // --- VIA Protocol ---
    getProtocolVersion: (): Promise<number> => protocol.getProtocolVersion(),
    getLayerCount: (): Promise<number> => protocol.getLayerCount(),
    getKeymapBuffer: (offset: number, size: number): Promise<number[]> =>
      protocol.getKeymapBuffer(offset, size),
    setKeycode: (layer: number, row: number, col: number, keycode: number): Promise<void> =>
      protocol.setKeycode(layer, row, col, keycode),
    getLayoutOptions: (): Promise<number> => protocol.getLayoutOptions(),
    setLayoutOptions: (options: number): Promise<void> => protocol.setLayoutOptions(options),

    // --- Vial Protocol ---
    getKeyboardId: (): Promise<KeyboardId> => protocol.getKeyboardId(),
    getDefinitionSize: (): Promise<number> => protocol.getDefinitionSize(),
    getDefinitionRaw: (size: number): Promise<number[]> =>
      protocol.getDefinitionRaw(size).then((buf) => Array.from(buf)),
    getDefinition: async (): Promise<KeyboardDefinition | null> => {
      try {
        const size = await protocol.getDefinitionSize()
        const raw = await protocol.getDefinitionRaw(size)
        const jsonStr = await decompressDefinition(raw)
        if (!jsonStr) {
          console.warn('Decompression returned null')
          return null
        }
        return JSON.parse(jsonStr) as KeyboardDefinition
      } catch (err) {
        console.warn('Failed to load keyboard definition:', err)
        return null
      }
    },
    getEncoder: (layer: number, index: number): Promise<[number, number]> =>
      protocol.getEncoder(layer, index),
    setEncoder: (layer: number, index: number, direction: number, keycode: number): Promise<void> =>
      protocol.setEncoder(layer, index, direction, keycode),

    // --- Macro ---
    getMacroCount: (): Promise<number> => protocol.getMacroCount(),
    getMacroBufferSize: (): Promise<number> => protocol.getMacroBufferSize(),
    getMacroBuffer: (totalSize: number): Promise<number[]> => protocol.getMacroBuffer(totalSize),
    setMacroBuffer: (data: number[]): Promise<void> => protocol.setMacroBuffer(data),

    // --- Lighting ---
    getLightingValue: (id: number): Promise<number[]> => protocol.getLightingValue(id),
    setLightingValue: (id: number, ...args: number[]): Promise<void> =>
      protocol.setLightingValue(id, ...args),
    saveLighting: (): Promise<void> => protocol.saveLighting(),

    // --- VialRGB ---
    getVialRGBInfo: (): Promise<{ version: number; maxBrightness: number }> =>
      protocol.getVialRGBInfo(),
    getVialRGBMode: (): Promise<{ mode: number; speed: number; hue: number; sat: number; val: number }> =>
      protocol.getVialRGBMode(),
    getVialRGBSupported: (): Promise<number[]> =>
      protocol.getVialRGBSupported().then((s) => Array.from(s)),
    setVialRGBMode: (mode: number, speed: number, hue: number, sat: number, val: number): Promise<void> =>
      protocol.setVialRGBMode(mode, speed, hue, sat, val),

    // --- Lock/Unlock ---
    getUnlockStatus: (): Promise<{ unlocked: boolean; inProgress: boolean; keys: [number, number][] }> =>
      protocol.getUnlockStatus(),
    unlockStart: (): Promise<void> => protocol.unlockStart(),
    unlockPoll: (): Promise<number[]> => protocol.unlockPoll(),
    lock: (): Promise<void> => protocol.lock(),

    // --- Dynamic Entries ---
    getDynamicEntryCount: (): Promise<{ tapDance: number; combo: number; keyOverride: number; altRepeatKey: number; featureFlags: number }> =>
      protocol.getDynamicEntryCount(),
    getTapDance: (index: number) => protocol.getTapDance(index),
    setTapDance: (index: number, entry) => protocol.setTapDance(index, entry),
    getCombo: (index: number) => protocol.getCombo(index),
    setCombo: (index: number, entry) => protocol.setCombo(index, entry),
    getKeyOverride: (index: number) => protocol.getKeyOverride(index),
    setKeyOverride: (index: number, entry) => protocol.setKeyOverride(index, entry),
    getAltRepeatKey: (index: number) => protocol.getAltRepeatKey(index),
    setAltRepeatKey: (index: number, entry) => protocol.setAltRepeatKey(index, entry),

    // --- QMK Settings ---
    qmkSettingsQuery: (startId: number): Promise<number[]> => protocol.qmkSettingsQuery(startId),
    qmkSettingsGet: (qsid: number): Promise<number[]> => protocol.qmkSettingsGet(qsid),
    qmkSettingsSet: (qsid: number, data: number[]): Promise<void> =>
      protocol.qmkSettingsSet(qsid, data),
    qmkSettingsReset: (): Promise<void> => protocol.qmkSettingsReset(),

    // --- Matrix Tester ---
    getMatrixState: (): Promise<number[]> => protocol.getMatrixState(),

    // --- Keychron Protocol ---
    keychronReload: (): Promise<unknown> => keychronProtocol.reloadKeychron(),
    keychronSetDebounce: (type: number, time: number): Promise<boolean> =>
      keychronProtocol.setKeychronDebounce(type, time),
    keychronSetNkro: (enabled: boolean): Promise<boolean> =>
      keychronProtocol.setKeychronNkro(enabled),
    keychronSetReportRate: (rate: number): Promise<boolean> =>
      keychronProtocol.setKeychronReportRate(rate),
    keychronSetPollRateV2: (usbRate: number, frRate: number): Promise<boolean> =>
      keychronProtocol.setKeychronPollRateV2(usbRate, frRate),
    keychronSetWirelessLpm: (backlitTime: number, idleTime: number): Promise<boolean> =>
      keychronProtocol.setKeychronWirelessLpm(backlitTime, idleTime),
    keychronSetSnapClick: (index: number, snapType: number, key1: number, key2: number): Promise<boolean> =>
      keychronProtocol.setKeychronSnapClick(index, snapType, key1, key2),
    keychronSaveSnapClick: (): Promise<boolean> => keychronProtocol.saveKeychronSnapClick(),
    keychronSetPerKeyRGBType: (effectType: number): Promise<void> =>
      keychronProtocol.setKeychronPerKeyRGBType(effectType),
    keychronSetPerKeyColor: (ledIndex: number, h: number, s: number, v: number): Promise<void> =>
      keychronProtocol.setKeychronPerKeyColor(ledIndex, h, s, v),
    keychronSaveRGB: (): Promise<void> => keychronProtocol.saveKeychronRGB(),
    keychronSetIndicators: (disableMask: number, hue: number, sat: number, val: number): Promise<void> =>
      keychronProtocol.setKeychronIndicators(disableMask, hue, sat, val),
    keychronSetMixedRGBRegions: (startIndex: number, regions: number[]): Promise<void> =>
      keychronProtocol.setKeychronMixedRGBRegions(startIndex, regions),
    keychronSetMixedRGBEffects: (regionIndex: number, startIndex: number, effects: import('../shared/types/keychron').MixedRGBEffect[]): Promise<void> =>
      keychronProtocol.setKeychronMixedRGBEffects(regionIndex, startIndex, effects),
    keychronAnalogReload: (rows: number, cols: number): Promise<unknown> =>
      keychronProtocol.reloadKeychronAnalog(rows, cols),
    keychronAnalogGetVersion: (): Promise<number> => keychronProtocol.getKeychronAnalogVersion(),
    keychronAnalogGetProfilesInfo: (): Promise<{ currentProfile: number; profileCount: number; profileSize: number; okmcCount: number; socdCount: number }> =>
      keychronProtocol.getKeychronAnalogProfilesInfo(),
    keychronAnalogGetCurve: (): Promise<number[]> => keychronProtocol.getKeychronAnalogCurve(),
    keychronAnalogSetCurve: (curvePoints: number[]): Promise<boolean> =>
      keychronProtocol.setKeychronAnalogCurve(curvePoints),
    keychronAnalogGetGameControllerMode: (): Promise<number> =>
      keychronProtocol.getKeychronAnalogGameControllerMode(),
    keychronAnalogSetProfile: (profileIndex: number): Promise<boolean> =>
      keychronProtocol.setKeychronAnalogProfile(profileIndex),
    keychronAnalogSetTravel: (profile: number, mode: number, actPt: number, sens: number, rlsSens: number, entire: boolean, rowMask?: number[]): Promise<boolean> =>
      keychronProtocol.setKeychronAnalogTravel(profile, mode, actPt, sens, rlsSens, entire, rowMask),
    keychronAnalogSetSocd: (profile: number, row1: number, col1: number, row2: number, col2: number, index: number, socdType: number): Promise<boolean> =>
      keychronProtocol.setKeychronAnalogSocd(profile, row1, col1, row2, col2, index, socdType),
    keychronAnalogSaveProfile: (profile: number): Promise<boolean> =>
      keychronProtocol.saveKeychronAnalogProfile(profile),
    keychronAnalogResetProfile: (profile: number): Promise<boolean> =>
      keychronProtocol.resetKeychronAnalogProfile(profile),
    keychronAnalogSetGameControllerMode: (mode: number): Promise<boolean> =>
      keychronProtocol.setKeychronAnalogGameControllerMode(mode),
    keychronAnalogGetProfileRaw: (profile: number, offset: number, size: number): Promise<number[]> =>
      keychronProtocol.getKeychronAnalogProfileRaw(profile, offset, size),
    keychronAnalogStartCalibration: (calibType: number): Promise<boolean> =>
      keychronProtocol.startKeychronCalibration(calibType),
    keychronAnalogGetCalibrationState: (): Promise<{ calibrated: number; state: number } | null> =>
      keychronProtocol.getKeychronCalibrationState(),
    keychronAnalogGetRealtimeTravel: (row: number, col: number): Promise<{ row: number; col: number; travelMm: number; travelRaw: number; value: number; zero: number; full: number; state: number } | null> =>
      keychronProtocol.getKeychronRealtimeTravel(row, col),
    keychronAnalogSetProfileName: (profile: number, name: string): Promise<boolean> =>
      keychronProtocol.setKeychronAnalogProfileName(profile, name),
    keychronAnalogSetAdvanceModeClear: (profile: number, row: number, col: number): Promise<boolean> =>
      keychronProtocol.setKeychronAnalogAdvanceModeClear(profile, row, col),
    keychronAnalogSetAdvanceModeDks: (profile: number, row: number, col: number, okmcIndex: number, shallowAct: number, shallowDeact: number, deepAct: number, deepDeact: number, keycodes: number[], actions: number[]): Promise<boolean> =>
      keychronProtocol.setKeychronAnalogAdvanceModeDks(profile, row, col, okmcIndex, shallowAct, shallowDeact, deepAct, deepDeact, keycodes, actions),
    keychronAnalogSetAdvanceModeToggle: (profile: number, row: number, col: number): Promise<boolean> =>
      keychronProtocol.setKeychronAnalogAdvanceModeToggle(profile, row, col),

    // --- Keychron DFU Flasher ---
    keychronDfuFlash: (firmwareData: ArrayBuffer) =>
      requestAndFlashWebDfu(firmwareData, (data) => {
        dfuListeners.forEach((cb) => cb(data))
      }),
    keychronDfuOnOutput: (callback: (data: { log?: string; progress?: number }) => void) => {
      dfuListeners.add(callback)
      return () => dfuListeners.delete(callback)
    },

    // --- Special Commands ---
    jumpToBootloader: async (): Promise<void> => {
      try {
        await protocol.resetDevice()
      } finally {
        await closeHidDevice()
      }
    },

    // --- Debug ---
    getDebugFlags: async () => ({ isWeb: 'true' }),

    // --- File I/O ---
    saveLayout: (json: string, deviceName?: string) => webFileIo.saveLayout(json, deviceName),
    loadLayout: (title?: string, extensions?: string[]) => webFileIo.loadLayout(title, extensions),
    exportKeymapC: (content: string, deviceName?: string) => webFileIo.exportKeymapC(content, deviceName),
    exportPdf: (base64Data: string, deviceName?: string) => webFileIo.exportPdf(base64Data, deviceName),
    exportCsv: (content: string, defaultName?: string) => webFileIo.exportCsv(content, defaultName),
    exportCsvBundle: (files) => webFileIo.exportCsvBundle(files),
    exportJson: (content: string, defaultName?: string) => webFileIo.exportJson(content, defaultName),
    sideloadJson: (title?: string) => webFileIo.sideloadJson(title),

    // --- Snapshot Store ---
    snapshotStoreList: (uid) => webStorage.snapshotStoreList(uid),
    snapshotStoreSave: (uid, json, deviceName, label, vilVersion) =>
      webStorage.snapshotStoreSave(uid, json, deviceName, label, vilVersion),
    snapshotStoreLoad: (uid, entryId) => webStorage.snapshotStoreLoad(uid, entryId),
    snapshotStoreUpdate: (uid, entryId, json, vilVersion) =>
      webStorage.snapshotStoreUpdate(uid, entryId, json, vilVersion),
    snapshotStoreRename: (uid, entryId, newLabel) =>
      webStorage.snapshotStoreRename(uid, entryId, newLabel),
    snapshotStoreDelete: (uid, entryId) => webStorage.snapshotStoreDelete(uid, entryId),

    // --- Analyze Filter Store ---
    analyzeFilterStoreList: (uid) => webStorage.analyzeFilterStoreList(uid),
    analyzeFilterStoreSave: (uid, json, label, summary) =>
      webStorage.analyzeFilterStoreSave(uid, json, label, summary),
    analyzeFilterStoreLoad: (uid, entryId) => webStorage.analyzeFilterStoreLoad(uid, entryId),
    analyzeFilterStoreUpdate: (uid, entryId, json) =>
      webStorage.analyzeFilterStoreUpdate(uid, entryId, json),
    analyzeFilterStoreRename: (uid, entryId, newLabel) =>
      webStorage.analyzeFilterStoreRename(uid, entryId, newLabel),
    analyzeFilterStoreDelete: (uid, entryId) => webStorage.analyzeFilterStoreDelete(uid, entryId),

    // --- Typing Run Log Store ---
    typingRunLogSave: (uid, log) => webStorage.typingRunLogSave(uid, log),
    typingRunLogList: (uid) => webStorage.typingRunLogList(uid),
    typingRunLogGet: (uid, runId) => webStorage.typingRunLogGet(uid, runId),

    // --- Favorite Store ---
    favoriteStoreList: (type) => webStorage.favoriteStoreList(type),
    favoriteStoreSave: (type, json, label) => webStorage.favoriteStoreSave(type, json, label),
    favoriteStoreLoad: (type, entryId) => webStorage.favoriteStoreLoad(type, entryId),
    favoriteStoreRename: (type, entryId, newLabel) =>
      webStorage.favoriteStoreRename(type, entryId, newLabel),
    favoriteStoreDelete: (type, entryId) => webStorage.favoriteStoreDelete(type, entryId),
    favoriteStoreExport: async () => ({ success: true }),
    favoriteStoreExportCurrent: async () => ({ success: true }),
    favoriteStoreImport: async () => ({ success: false, error: 'Not supported' }),
    favoriteStoreImportToCurrent: async () => ({ success: false, error: 'Not supported' }),

    // --- Key Label Store ---
    keyLabelStoreList: () => webStorage.keyLabelStoreList(),
    keyLabelStoreListAll: () => webStorage.keyLabelStoreList(),
    keyLabelStoreGet: (id) => webStorage.keyLabelStoreGet(id),
    keyLabelStoreRename: (id, newName) => webStorage.keyLabelStoreRename(id, newName),
    keyLabelStoreDelete: (id) => webStorage.keyLabelStoreDelete(id),
    keyLabelStoreImport: async () => ({ success: false, error: 'Not supported' }),
    keyLabelStoreExport: async () => ({ success: false, error: 'Not supported' }),
    keyLabelStoreReorder: (orderedIds) => webStorage.keyLabelStoreReorder(orderedIds),
    keyLabelStoreSetHubPostId: async () => ({ success: false, error: 'Not supported' }),
    keyLabelStoreHasName: async () => ({ success: true, data: false }),

    // --- Typing Test Text Store ---
    typingTestTextStoreList: () => webStorage.typingTestTextStoreList(),
    typingTestTextStoreGet: (id) => webStorage.typingTestTextStoreGet(id),
    typingTestTextStoreRename: (id, newName) => webStorage.typingTestTextStoreRename(id, newName),
    typingTestTextStoreDelete: (id) => webStorage.typingTestTextStoreDelete(id),
    typingTestTextStoreImport: async () => ({ success: false, error: 'Not supported' }),
    typingTestTextStoreImportConfirm: async () => ({ success: false, error: 'Not supported' }),

    // --- Key Label Hub ---
    keyLabelHubList: async () => ({ success: true, data: { items: [], total: 0 } }),
    keyLabelHubDetail: async () => ({ success: false, error: 'Not supported' }),
    keyLabelHubDownload: async () => ({ success: false, error: 'Not supported' }),
    keyLabelHubUpload: async () => ({ success: false, error: 'Not supported' }),
    keyLabelHubUpdate: async () => ({ success: false, error: 'Not supported' }),
    keyLabelHubSync: async () => ({ success: false, error: 'Not supported' }),
    keyLabelHubTimestamps: async () => ({ success: true, data: { timestamps: {} } }),
    keyLabelHubDelete: async () => ({ success: false, error: 'Not supported' }),

    // --- Pipette Settings Store ---
    pipetteSettingsGet: (uid) => webStorage.pipetteSettingsGet(uid),
    pipetteSettingsPatch: (uid, partial) => webStorage.pipetteSettingsPatch(uid, partial),
    pipetteSettingsListAllTypingResults: () => webStorage.pipetteSettingsListAllTypingResults(),

    // --- Typing Analytics (Web fallbacks) ---
    typingAnalyticsEvent: async () => {},
    typingAnalyticsFlush: async () => {},
    typingAnalyticsListAppsForRange: async () => [],
    typingAnalyticsListTypingTestsForRange: async () => [],
    typingAnalyticsListTypingTestRunsForRange: async () => [],
    typingAnalyticsGetAppUsageForRange: async () => [],
    typingAnalyticsGetWpmByAppForRange: async () => [],
    typingAnalyticsListKeyboards: async () => [],
    typingAnalyticsListItems: async () => [],
    typingAnalyticsDeleteItems: async () => ({ deleted: 0, tombstoned: 0 }),
    typingAnalyticsDeleteAll: async () => ({ deleted: 0, tombstoned: 0 }),
    typingAnalyticsGetMatrixHeatmap: async () => ({ cells: {} }),
    typingAnalyticsListItemsLocal: async () => [],
    typingAnalyticsListDeviceInfos: async () => null,
    typingAnalyticsListItemsForHash: async () => [],
    typingAnalyticsListIntervalItems: async () => [],
    typingAnalyticsListIntervalItemsLocal: async () => [],
    typingAnalyticsListIntervalItemsForHash: async () => [],
    typingAnalyticsListActivityGrid: async () => [],
    typingAnalyticsListActivityGridLocal: async () => [],
    typingAnalyticsListActivityGridForHash: async () => [],
    typingAnalyticsListLayerUsage: async () => [],
    typingAnalyticsListLayerUsageLocal: async () => [],
    typingAnalyticsListLayerUsageForHash: async () => [],
    typingAnalyticsListMatrixCells: async () => [],
    typingAnalyticsListMatrixCellsLocal: async () => [],
    typingAnalyticsListMatrixCellsForHash: async () => [],
    typingAnalyticsListMatrixCellsByDay: async () => [],
    typingAnalyticsListMatrixCellsByDayLocal: async () => [],
    typingAnalyticsListMatrixCellsByDayForHash: async () => [],
    typingAnalyticsListMinuteStats: async () => [],
    typingAnalyticsListMinuteStatsLocal: async () => [],
    typingAnalyticsListMinuteStatsForHash: async () => [],
    typingAnalyticsListSessions: async () => [],
    typingAnalyticsListSessionsLocal: async () => [],
    typingAnalyticsListSessionsForHash: async () => [],
    typingAnalyticsListBksMinute: async () => [],
    typingAnalyticsListBksMinuteLocal: async () => [],
    typingAnalyticsListBksMinuteForHash: async () => [],
    typingAnalyticsGetPeakRecords: async () => ({ maxWpm: 0, maxKpm: 0 }),
    typingAnalyticsGetPeakRecordsLocal: async () => ({ maxWpm: 0, maxKpm: 0 }),
    typingAnalyticsGetPeakRecordsForHash: async () => ({ maxWpm: 0, maxKpm: 0 }),
    typingAnalyticsSaveKeymapSnapshot: async () => ({ saved: false, savedAt: null }),
    typingAnalyticsGetKeymapSnapshotForRange: async () => null,
    typingAnalyticsListKeymapSnapshots: async () => [],
    typingAnalyticsGetMatrixHeatmapForRange: async () => ({ cells: {} }),
    typingAnalyticsGetBigramAggregateForRange: async () => ({ bigrams: [] }),
    typingAnalyticsListRolloverMinutes: async () => [],
    typingAnalyticsListDurationCells: async () => [],
    typingAnalyticsGetLayoutComparisonForRange: async () => null,
    typingAnalyticsListLocalDeviceDays: async () => [],
    typingAnalyticsHasRemote: async () => false,
    typingAnalyticsListRemoteCloudHashes: async () => [],
    typingAnalyticsListRemoteCloudDays: async () => [],
    typingAnalyticsFetchRemoteDay: async () => false,
    typingAnalyticsDeleteRemoteDay: async () => false,
    typingAnalyticsExport: async () => ({ written: 0, cancelled: false }),
    typingAnalyticsImport: async () => ({ result: { imported: 0, rejections: [] }, cancelled: false }),

    // --- App Config ---
    appConfigGetAll: () => webStorage.appConfigGetAll(),
    appConfigSet: (key, value) => webStorage.appConfigSet(key, value),

    // --- Sync ---
    syncAuthStart: async () => ({ success: false, error: 'Sync requires backend' }),
    syncAuthStatus: async () => ({ authenticated: false, email: null }),
    syncAuthSignOut: async () => ({ success: true }),
    syncExecute: async () => ({ success: false, error: 'Sync requires backend' }),
    syncSetPassword: async () => ({ success: false, error: 'Sync requires backend' }),
    syncChangePassword: async () => ({ success: false, error: 'Sync requires backend' }),
    syncResetTargets: async () => ({ success: false, error: 'Sync requires backend' }),
    syncHasPassword: async () => false,
    syncValidatePassword: async () => ({ score: 0, feedback: [] }),
    syncOnProgress: () => () => {},
    syncHasPendingChanges: async () => false,
    syncListUndecryptable: async () => [],
    syncScanRemote: async () => ({ files: [] }),
    syncFetchRemoteBundle: async () => null,
    syncDeleteFiles: async () => ({ success: true }),
    syncCheckPasswordExists: async () => false,
    syncAnalyticsNow: async () => false,
    syncOnPendingChange: () => () => {},

    // --- Language Store ---
    langList: async () => [],
    langGet: async () => null,
    langDownload: async () => ({ success: false, error: 'Not implemented' }),
    langDelete: async () => ({ success: false, error: 'Not implemented' }),
    checkTypingDatasetUpdate: async () => ({ provider: 'built-in', updateAvailable: false }),
    updateTypingDataset: async () => ({ provider: 'built-in', changed: false, fromVersion: '1.0.0' }),

    // --- Aozora Bunko ---
    aozoraImport: async () => ({ success: false, error: 'Not implemented in web' }),

    // --- Data Management ---
    listStoredKeyboards: () => webStorage.listStoredKeyboards(),
    keyboardMetaNameIfMissing: (uid, name) => webStorage.keyboardMetaNameIfMissing(uid, name),
    resetKeyboardData: async () => ({ success: true }),
    resetLocalTargets: async () => ({ success: true }),
    exportLocalData: async () => ({ success: false, error: 'Not implemented' }),
    importLocalData: async () => ({ success: false, error: 'Not implemented' }),

    // --- Hub ---
    hubUploadPost: async () => ({ success: false, error: 'Hub requires backend' }),
    hubUploadPrivatePost: async () => ({ success: false, error: 'Hub requires backend' }),
    hubDeletePrivatePost: async () => ({ success: false, error: 'Hub requires backend' }),
    hubUpdatePost: async () => ({ success: false, error: 'Hub requires backend' }),
    hubPatchPost: async () => ({ success: false, error: 'Hub requires backend' }),
    hubDeletePost: async () => ({ success: false, error: 'Hub requires backend' }),
    hubFetchMyPosts: async () => ({ success: true, posts: [] }),
    hubFetchMyKeyboardPosts: async () => ({ success: true, posts: [] }),
    hubFetchAuthMe: async () => ({ success: false, error: 'Not authenticated' }),
    hubPatchAuthMe: async () => ({ success: false, error: 'Not authenticated' }),
    hubSetAuthDisplayName: async () => {},
    hubGetOrigin: async () => 'https://hub.pipette.app',

    // --- Notification ---
    notificationFetch: async () => ({ notifications: [] }),

    // --- Shell ---
    openExternal: async (url: string): Promise<void> => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },

    // --- Snapshot Store extensions ---
    snapshotStoreSetHubPostId: async () => ({ success: true }),
    snapshotStoreSetHubPrivate: async () => ({ success: true }),

    // --- Hub Feature posts ---
    hubUploadFavoritePost: async () => ({ success: false, error: 'Hub requires backend' }),
    hubUploadPrivateFavoritePost: async () => ({ success: false, error: 'Hub requires backend' }),
    hubUpdateFavoritePost: async () => ({ success: false, error: 'Hub requires backend' }),

    // --- Hub Analytics posts ---
    hubUploadAnalyticsPost: async () => ({ success: false, error: 'Hub requires backend' }),
    hubUploadPrivateAnalyticsPost: async () => ({ success: false, error: 'Hub requires backend' }),
    hubUpdateAnalyticsPost: async () => ({ success: false, error: 'Hub requires backend' }),
    hubPreviewAnalyticsPost: async () => ({ success: false, error: 'Hub requires backend' }),

    // --- i18n language pack store ---
    i18nPackList: () => webStorage.i18nPackList(),
    i18nPackGet: (id) => webStorage.i18nPackGet(id),
    i18nPackRename: async () => ({ success: true, data: undefined as any }),
    i18nPackSetEnabled: async () => ({ success: true, data: undefined as any }),
    i18nPackDelete: async () => ({ success: true }),
    i18nPackSetHubPostId: async () => ({ success: true, data: undefined as any }),
    i18nPackHasName: async () => ({ success: true, data: false }),
    i18nPackReorder: async () => ({ success: true }),
    i18nPackImport: async () => ({ success: false, error: 'Not supported' }),
    i18nPackImportApply: async () => ({ success: false, error: 'Not supported' }),
    i18nPackExport: async () => ({ success: false, error: 'Not supported' }),
    i18nPackHubTimestamps: async () => ({ success: true, data: { timestamps: {} } }),
    i18nPackOnChanged: () => () => {},

    // --- Theme pack store ---
    themePackList: () => webStorage.themePackList(),
    themePackGet: (id) => webStorage.themePackGet(id),
    themePackRename: async () => ({ success: true, data: undefined as any }),
    themePackDelete: async () => ({ success: true }),
    themePackSetHubPostId: async () => ({ success: true, data: undefined as any }),
    themePackHasName: async () => ({ success: true, data: false }),
    themePackReorder: async () => ({ success: true }),
    themePackImport: async () => ({ success: false, error: 'Not supported' }),
    themePackImportApply: async () => ({ success: false, error: 'Not supported' }),
    themePackExport: async () => ({ success: false, error: 'Not supported' }),
    themePackHubTimestamps: async () => ({ success: true, data: { timestamps: {} } }),
    themePackOnChanged: () => () => {},

    // --- Hub theme posts ---
    hubListThemePosts: async () => ({ success: true, data: { items: [], total: 0 } }),
    hubDownloadThemePost: async () => ({ success: false, error: 'Not supported' }),
    hubUploadThemePost: async () => ({ success: false, error: 'Not supported' }),
    hubUpdateThemePost: async () => ({ success: false, error: 'Not supported' }),
    hubDeleteThemePost: async () => ({ success: false, error: 'Not supported' }),

    // --- Hub i18n posts ---
    hubListI18nPosts: async () => ({ success: true, data: { items: [], total: 0 } }),
    hubDownloadI18nPost: async () => ({ success: false, error: 'Not supported' }),
    hubUploadI18nPost: async () => ({ success: false, error: 'Not supported' }),
    hubUpdateI18nPost: async () => ({ success: false, error: 'Not supported' }),
    hubDeleteI18nPost: async () => ({ success: false, error: 'Not supported' }),

    // --- Favorite Store extensions ---
    favoriteStoreSetHubPostId: async () => ({ success: true }),
    favoriteStoreSetHubPrivate: async () => ({ success: true }),

    // --- Analyze Filter Store extensions ---
    analyzeFilterStoreSetHubPostId: async () => ({ success: true }),
    analyzeFilterStoreSetHubPrivate: async () => ({ success: true }),

    // --- Window management (Web stubs) ---
    setWindowCompactMode: async () => null,
    setWindowAspectRatio: async () => {},
    setWindowAlwaysOnTop: async () => {},
    setWindowMinSize: async () => {},
    isAlwaysOnTopSupported: async () => false,
    setWindowZoom: async (zoom: number) => {
      const factor = zoom > 10 ? zoom / 100 : zoom
      document.documentElement.style.zoom = String(factor)
    },
    windowShow: async () => true,
    windowHide: async () => {},
    windowStartedHidden: async () => false,
    windowIsVisible: async () => !document.hidden,
    onWindowVisibilityChanged: (callback: (visible: boolean) => void) => {
      const handler = () => callback(!document.hidden)
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    },

    // --- Tray status ---
    trayStatusUpdate: async (_status: TrayStatus) => {},
  }
}
