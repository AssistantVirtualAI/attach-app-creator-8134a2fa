// Lemtel Phase 25B — the Desktop greeting card is passive; the portal is the sole authority.
// Renders locally only: no network, no backend, no media, no repository change.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import VoicemailGreetingCard from './VoicemailGreetingCard';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Phase 25B — VoicemailGreetingCard portal authority', () => {
  it('renders the portal-only note with both sentences', () => {
    render(<VoicemailGreetingCard />);
    const card = screen.getByTestId('desktop-voicemail-greeting-portal-only');
    expect(card.getAttribute('role')).toBe('note');
    expect(card.textContent).toContain('Voicemail greeting is managed in the Lemtel portal.');
    expect(card.textContent).toContain('Open the Lemtel portal to review or change voicemail settings.');
  });

  it('renders no interactive or media element and no interaction attribute', () => {
    const { container } = render(<VoicemailGreetingCard />);
    expect(container.querySelector('button, input, textarea, select, audio, a, [href], [onclick], [tabindex]')).toBeNull();
  });

  it('performs no network request on render', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(<VoicemailGreetingCard />);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
