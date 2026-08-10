// SPDX-License-Identifier: GPL-2.0-or-later
// Connected-view overlay modals: Unlock dialog, lighting configurator,
// Combo/AltRepeatKey/KeyOverride panels, startup notifications, the
// missing-key-label dialog, the ja-removed banner, and Keychron modals.
// Split out of App.tsx (Task-split-app-tsx).

import { useTranslation } from 'react-i18next'
import { UnlockDialog } from './editors/UnlockDialog'
import { ModalCloseButton } from './editors/ModalCloseButton'
import { RGBConfigurator } from './editors/RGBConfigurator'
import { ComboPanelModal } from './editors/ComboPanelModal'
import { AltRepeatKeyPanelModal } from './editors/AltRepeatKeyPanelModal'
import { KeyOverridePanelModal } from './editors/KeyOverridePanelModal'
import { NotificationModal } from './NotificationModal'
import { MissingKeyLabelDialog } from './key-labels/MissingKeyLabelDialog'
import { JaRemovedBanner } from './i18n-packs/JaRemovedBanner'
import { KeychronSettings } from './editors/KeychronSettings'
import { KeychronRGB } from './editors/KeychronRGB'
import { KeychronDfuFlasher } from './editors/KeychronDfuFlasher'
import { KeychronAnalog } from './editors/KeychronAnalog'
import { KeychronSocd } from './editors/KeychronSocd'
import { KeychronModalShell } from './editors/KeychronModalShell'
import type { decodeLayoutOptions } from '../../shared/kle/layout-options'
import type { deserializeAllMacros } from '../../preload/macro'
import type { useDeviceConnection } from '../hooks/useDeviceConnection'
import type { useKeyboard } from '../hooks/useKeyboard'
import type { useEditorUIState } from '../hooks/useEditorUIState'
import type { UseDevicePrefsReturn } from '../hooks/useDevicePrefs'
import type { useHubState } from '../hooks/useHubState'
import type { useStartupNotification } from '../hooks/useStartupNotification'
import type { useMissingKeyLabelNotice } from '../hooks/useMissingKeyLabelNotice'
import type { KeychronAnalogState } from '../../shared/types/keychron'

interface Props {
  device: ReturnType<typeof useDeviceConnection>
  keyboard: ReturnType<typeof useKeyboard>
  editorUI: ReturnType<typeof useEditorUIState>
  devicePrefs: UseDevicePrefsReturn
  hub: ReturnType<typeof useHubState>
  startupNotification: ReturnType<typeof useStartupNotification>
  missingKeyLabel: ReturnType<typeof useMissingKeyLabelNotice>
  decodedLayoutOptions: ReturnType<typeof decodeLayoutOptions>
  deserializedMacros: ReturnType<typeof deserializeAllMacros> | undefined
  keychronSupported: boolean
  isBridge: boolean
  showKeychronModal: boolean
  setShowKeychronModal: (v: boolean) => void
  showKeychronRgbModal: boolean
  setShowKeychronRgbModal: (v: boolean) => void
  showKeychronFlasherModal: boolean
  setShowKeychronFlasherModal: (v: boolean) => void
  showKeychronAnalogModal: boolean
  setShowKeychronAnalogModal: (v: boolean) => void
  showKeychronSocdModal: boolean
  setShowKeychronSocdModal: (v: boolean) => void
  keychronAnalogData: KeychronAnalogState | null
  setKeychronAnalogData: (v: KeychronAnalogState | null) => void
  handleOpenKeychronAnalog: () => void
}

export function AppModals({
  device,
  keyboard,
  editorUI,
  devicePrefs,
  hub,
  startupNotification,
  missingKeyLabel,
  decodedLayoutOptions,
  deserializedMacros,
  keychronSupported,
  showKeychronModal,
  setShowKeychronModal,
  showKeychronRgbModal,
  setShowKeychronRgbModal,
  showKeychronFlasherModal,
  setShowKeychronFlasherModal,
  showKeychronAnalogModal,
  setShowKeychronAnalogModal,
  showKeychronSocdModal,
  setShowKeychronSocdModal,
  keychronAnalogData,
}: Props) {
  const { t } = useTranslation()
  const api = window.vialAPI

  return (
    <>
      {editorUI.showUnlockDialog && !device.isDummy && (
        <UnlockDialog
          keys={keyboard.layout?.keys ?? []}
          unlockKeys={keyboard.unlockStatus.keys}
          layoutOptions={decodedLayoutOptions}
          unlockStart={() => { device.setPollSuspended(true); return api.unlockStart() }}
          unlockPoll={api.unlockPoll}
          onComplete={async () => {
            device.setPollSuspended(false)
            editorUI.setShowUnlockDialog(false)
            editorUI.setUnlockMacroWarning(false)
            await keyboard.refreshUnlockStatus()
          }}
          onDisconnect={() => {
            device.setPollSuspended(false)
            editorUI.setShowUnlockDialog(false)
            editorUI.setUnlockMacroWarning(false)
            keyboard.rejectPendingUnlock()
          }}
          macroWarning={editorUI.unlockMacroWarning}
        />
      )}

      {editorUI.showLightingModal && editorUI.lightingSupported && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          data-testid="lighting-modal-backdrop"
          onClick={() => editorUI.setShowLightingModal(false)}
        >
          <div
            className="w-modal-app max-w-modal-vw max-h-modal-80vh overflow-y-auto rounded-lg bg-surface-alt p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t('editor.lighting.title')}</h3>
              <ModalCloseButton testid="lighting-modal-close" onClick={() => editorUI.setShowLightingModal(false)} />
            </div>
            <RGBConfigurator
              lightingType={keyboard.definition?.lighting}
              backlightBrightness={keyboard.backlightBrightness}
              backlightEffect={keyboard.backlightEffect}
              rgblightBrightness={keyboard.rgblightBrightness}
              rgblightEffect={keyboard.rgblightEffect}
              rgblightEffectSpeed={keyboard.rgblightEffectSpeed}
              rgblightHue={keyboard.rgblightHue}
              rgblightSat={keyboard.rgblightSat}
              vialRGBVersion={keyboard.vialRGBVersion}
              vialRGBMode={keyboard.vialRGBMode}
              vialRGBSpeed={keyboard.vialRGBSpeed}
              vialRGBHue={keyboard.vialRGBHue}
              vialRGBSat={keyboard.vialRGBSat}
              vialRGBVal={keyboard.vialRGBVal}
              vialRGBMaxBrightness={keyboard.vialRGBMaxBrightness}
              vialRGBSupported={keyboard.vialRGBSupported}
              onSetBacklightBrightness={keyboard.setBacklightBrightness}
              onSetBacklightEffect={keyboard.setBacklightEffect}
              onSetRgblightBrightness={keyboard.setRgblightBrightness}
              onSetRgblightEffect={keyboard.setRgblightEffect}
              onSetRgblightEffectSpeed={keyboard.setRgblightEffectSpeed}
              onSetRgblightColor={keyboard.setRgblightColor}
              onSetVialRGBMode={keyboard.setVialRGBMode}
              onSetVialRGBSpeed={keyboard.setVialRGBSpeed}
              onSetVialRGBColor={keyboard.setVialRGBColor}
              onSetVialRGBBrightness={keyboard.setVialRGBBrightness}
              onSetVialRGBHSV={keyboard.setVialRGBHSV}
              onSave={api.saveLighting}
            />
          </div>
        </div>
      )}

      {editorUI.comboSupported && editorUI.comboInitialIndex !== null && (
        <ComboPanelModal
          entries={keyboard.comboEntries}
          onSetEntry={keyboard.setComboEntry}
          initialIndex={editorUI.comboInitialIndex}
          unlocked={keyboard.unlockStatus.unlocked}
          onUnlock={() => editorUI.setShowUnlockDialog(true)}
          tapDanceEntries={keyboard.tapDanceEntries}
          deserializedMacros={deserializedMacros}
          quickSelect={devicePrefs.quickSelect}
          splitKeyMode={devicePrefs.splitKeyMode}
          basicViewType={devicePrefs.basicViewType}
          vialProtocol={keyboard.vialProtocol}
          onClose={() => editorUI.setComboInitialIndex(null)}
          hubOrigin={hub.hubReady ? hub.hubOrigin : undefined}
          hubNeedsDisplayName={hub.hubReady && !hub.hubCanUpload}
          hubUploading={hub.favHubUploading}
          hubUploadResult={hub.favHubUploadResult}
          onUploadToHub={hub.hubCanUpload ? (entryId) => hub.handleFavUploadToHub('combo', entryId) : undefined}
          onUpdateOnHub={hub.hubCanUpload ? (entryId) => hub.handleFavUpdateOnHub('combo', entryId) : undefined}
          onRemoveFromHub={hub.hubReady ? (entryId) => hub.handleFavRemoveFromHub('combo', entryId) : undefined}
          onRenameOnHub={hub.hubReady ? hub.handleFavRenameOnHub : undefined}
        />
      )}

      {editorUI.altRepeatKeySupported && editorUI.altRepeatKeyInitialIndex !== null && (
        <AltRepeatKeyPanelModal
          entries={keyboard.altRepeatKeyEntries}
          onSetEntry={keyboard.setAltRepeatKeyEntry}
          initialIndex={editorUI.altRepeatKeyInitialIndex}
          unlocked={keyboard.unlockStatus.unlocked}
          onUnlock={() => editorUI.setShowUnlockDialog(true)}
          tapDanceEntries={keyboard.tapDanceEntries}
          deserializedMacros={deserializedMacros}
          quickSelect={devicePrefs.quickSelect}
          splitKeyMode={devicePrefs.splitKeyMode}
          basicViewType={devicePrefs.basicViewType}
          vialProtocol={keyboard.vialProtocol}
          onClose={() => editorUI.setAltRepeatKeyInitialIndex(null)}
          hubOrigin={hub.hubReady ? hub.hubOrigin : undefined}
          hubNeedsDisplayName={hub.hubReady && !hub.hubCanUpload}
          hubUploading={hub.favHubUploading}
          hubUploadResult={hub.favHubUploadResult}
          onUploadToHub={hub.hubCanUpload ? (entryId) => hub.handleFavUploadToHub('altRepeatKey', entryId) : undefined}
          onUpdateOnHub={hub.hubCanUpload ? (entryId) => hub.handleFavUpdateOnHub('altRepeatKey', entryId) : undefined}
          onRemoveFromHub={hub.hubReady ? (entryId) => hub.handleFavRemoveFromHub('altRepeatKey', entryId) : undefined}
          onRenameOnHub={hub.hubReady ? hub.handleFavRenameOnHub : undefined}
        />
      )}

      {editorUI.keyOverrideSupported && editorUI.keyOverrideInitialIndex !== null && (
        <KeyOverridePanelModal
          entries={keyboard.keyOverrideEntries}
          onSetEntry={keyboard.setKeyOverrideEntry}
          initialIndex={editorUI.keyOverrideInitialIndex}
          unlocked={keyboard.unlockStatus.unlocked}
          onUnlock={() => editorUI.setShowUnlockDialog(true)}
          tapDanceEntries={keyboard.tapDanceEntries}
          deserializedMacros={deserializedMacros}
          quickSelect={devicePrefs.quickSelect}
          splitKeyMode={devicePrefs.splitKeyMode}
          basicViewType={devicePrefs.basicViewType}
          vialProtocol={keyboard.vialProtocol}
          onClose={() => editorUI.setKeyOverrideInitialIndex(null)}
          hubOrigin={hub.hubReady ? hub.hubOrigin : undefined}
          hubNeedsDisplayName={hub.hubReady && !hub.hubCanUpload}
          hubUploading={hub.favHubUploading}
          hubUploadResult={hub.favHubUploadResult}
          onUploadToHub={hub.hubCanUpload ? (entryId) => hub.handleFavUploadToHub('keyOverride', entryId) : undefined}
          onUpdateOnHub={hub.hubCanUpload ? (entryId) => hub.handleFavUpdateOnHub('keyOverride', entryId) : undefined}
          onRemoveFromHub={hub.hubReady ? (entryId) => hub.handleFavRemoveFromHub('keyOverride', entryId) : undefined}
          onRenameOnHub={hub.hubReady ? hub.handleFavRenameOnHub : undefined}
        />
      )}

      {startupNotification.visible && (
        <NotificationModal
          notifications={startupNotification.notifications}
          onClose={startupNotification.dismiss}
        />
      )}

      <MissingKeyLabelDialog
        open={missingKeyLabel.missingName !== null}
        missingName={missingKeyLabel.missingName ?? ''}
        onClose={() => {
          missingKeyLabel.dismiss()
          // Flip the active layout to qwerty so the dropdown reflects
          // the fallback and `pipette_settings.json` is updated by
          // useDevicePrefs' own save path. Without this the next
          // connect would still hit the same missing id.
          devicePrefs.setLayout('qwerty')
        }}
      />
      <JaRemovedBanner />

      {showKeychronRgbModal && keyboard.keychron?.hasRgb && keyboard.keychron.rgb && (
        <KeychronModalShell
          title={t("keymap.keychronRgb", "Keychron RGB")}
          testId="keychron-rgb-modal"
          onClose={() => setShowKeychronRgbModal(false)}
          width="w-modal-2xl"
        >
          <KeychronRGB
            rgb={keyboard.keychron.rgb}
            ledMatrix={keyboard.keychron.rgb.ledMatrix}
            keys={keyboard.layout?.keys ?? []}
            vialRGBMode={keyboard.vialRGBMode}
            vialRGBSpeed={keyboard.vialRGBSpeed}
            vialRGBHue={keyboard.vialRGBHue}
            vialRGBSat={keyboard.vialRGBSat}
            vialRGBVal={keyboard.vialRGBVal}
            vialRGBMaxBrightness={keyboard.vialRGBMaxBrightness}
            vialRGBSupported={keyboard.vialRGBSupported}
            onSetVialRGBMode={keyboard.setVialRGBMode}
            onSetVialRGBSpeed={keyboard.setVialRGBSpeed}
            onSetVialRGBColor={keyboard.setVialRGBColor}
            onSetVialRGBBrightness={keyboard.setVialRGBBrightness}
          />
        </KeychronModalShell>
      )}

      {showKeychronFlasherModal && (
        <KeychronDfuFlasher
          isOpen={showKeychronFlasherModal}
          onClose={() => setShowKeychronFlasherModal(false)}
          onSaveBackup={async () => {
            try {
              return keyboard.serialize()
            } catch {
              return null
            }
          }}
          onRestoreBackup={async (backup) => {
            await keyboard.applyVilFile(backup)
          }}
          unlocked={keyboard.unlockStatus.unlocked}
          onUnlock={() => editorUI.setShowUnlockDialog(true)}
          setSuppressDisconnect={device.setSuppressDisconnect}
          originalDevice={device.connectedDevice}
          connectDevice={device.connectDevice}
          onReload={async () => {
            await keyboard.reload()
          }}
        />
      )}

      {showKeychronAnalogModal && keychronAnalogData && (
        <KeychronModalShell
          title={t("keychron.analog.title", "Analog Matrix (HE)")}
          testId="keychron-analog-modal"
          onClose={() => setShowKeychronAnalogModal(false)}
          width="w-modal-3xl"
        >
          <KeychronAnalog
            analog={keychronAnalogData}
            keys={keyboard.layout?.keys ?? []}
            rows={keyboard.rows}
            cols={keyboard.cols}
            keymap={keyboard.keymap}
            defaultLayer={keyboard.keychron?.defaultLayer ?? 0}
          />
        </KeychronModalShell>
      )}

      {showKeychronSocdModal && keyboard.keychron?.hasSnapClick && (
        <KeychronSocd
          keychron={keyboard.keychron}
          keys={keyboard.layout?.keys ?? []}
          keymap={keyboard.keymap}
          onSettingChanged={keyboard.refreshKeychron}
          onClose={() => setShowKeychronSocdModal(false)}
        />
      )}

      {showKeychronModal && keychronSupported && keyboard.keychron && (
        <KeychronModalShell
          title={t("keychron.settings", "Keychron Settings")}
          testId="keychron-modal"
          onClose={() => setShowKeychronModal(false)}
          width="w-modal-md"
        >
          <KeychronSettings keychron={keyboard.keychron} onSettingChanged={keyboard.refreshKeychron} />
        </KeychronModalShell>
      )}
    </>
  )
}
