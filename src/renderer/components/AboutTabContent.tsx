// SPDX-License-Identifier: GPL-2.0-or-later

import { useTranslation } from 'react-i18next'
import appIcon from '../assets/app-icon.png'

const TERMS_SECTIONS = [
  'termsGoogleDrive',
  'termsHubData',
  'termsHidAccess',
  'termsLocalData',
  'termsOpenSource',
] as const

export function AboutTabContent() {
  const { t } = useTranslation()

  return (
    <div className="pt-4 space-y-6">
      <div className="flex flex-col items-center gap-3">
        <img
          src={appIcon}
          alt="Pipette"
          width={64}
          height={64}
          data-testid="about-app-icon"
        />
        <h3
          className="text-lg font-bold text-content"
          data-testid="about-app-name"
        >
          Pipette
        </h3>
        <span
          className="text-sm text-content-muted"
          data-testid="about-app-version"
        >
          {t('settings.about.version', { version: __APP_VERSION__ })}
        </span>
        <span
          className="text-sm text-content-muted"
          data-testid="about-license"
        >
          {t('settings.about.license', { license: t('settings.about.licenseValue') })}
        </span>
      </div>

      <div
        className="max-h-60 overflow-y-auto rounded-lg border border-edge bg-surface p-4 space-y-3"
        data-testid="about-terms-content"
      >
        <h4 className="text-sm font-medium text-content">
          {t('settings.about.termsTitle')}
        </h4>
        {TERMS_SECTIONS.map((key) => (
          <p key={key} className="text-xs text-content-muted leading-relaxed">
            {t(`settings.about.${key}`)}
          </p>
        ))}
        <p className="text-xs text-content-muted leading-relaxed font-medium">
          {t('settings.about.termsDisclaimer')}
        </p>
      </div>
    </div>
  )
}
