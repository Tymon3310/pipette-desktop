// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KeychronDfuFlasher } from '../KeychronDfuFlasher'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fallback?: string) => fallback ?? k }),
}))

describe('KeychronDfuFlasher', () => {
  it('renders flasher modal with title and controls', () => {
    render(
      <KeychronDfuFlasher
        isOpen={true}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Keychron Firmware Flasher')).toBeInTheDocument()
    expect(screen.getByText('Drag and drop your .bin file here')).toBeInTheDocument()
    expect(screen.getByText('Restore current layout after flashing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Flash Firmware' })).toBeInTheDocument()
  })
})
