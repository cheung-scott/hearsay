// @vitest-environment jsdom
//
// Unit tests for the CaseLabel gauntlet HUD component.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
import { CaseLabel } from './CaseLabel';

describe('CaseLabel', () => {
  it('renders nothing when caseNumber is 0 (progress is empty / unstarted)', () => {
    const { container } = render(
      <CaseLabel caseNumber={0} totalCases={4} persona="Novice" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when caseNumber is negative', () => {
    const { container } = render(
      <CaseLabel caseNumber={-1} totalCases={4} persona="Novice" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when persona is null', () => {
    const { container } = render(
      <CaseLabel caseNumber={1} totalCases={4} persona={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders "CASE 1 OF 4 — THE DEFENDANT" when facing Novice on case 1', () => {
    const { getByTestId } = render(
      <CaseLabel caseNumber={1} totalCases={4} persona="Novice" />,
    );
    const el = getByTestId('case-label');
    expect(el.textContent).toBe('CASE 1 OF 4 — THE DEFENDANT');
  });

  it('renders "CASE 2 OF 4 — THE PROSECUTOR" when facing Reader on case 2', () => {
    const { getByTestId } = render(
      <CaseLabel caseNumber={2} totalCases={4} persona="Reader" />,
    );
    const el = getByTestId('case-label');
    expect(el.textContent).toBe('CASE 2 OF 4 — THE PROSECUTOR');
  });

  it('renders "CASE 3 OF 4 — THE ATTORNEY" when facing Misdirector on case 3', () => {
    const { getByTestId } = render(
      <CaseLabel caseNumber={3} totalCases={4} persona="Misdirector" />,
    );
    const el = getByTestId('case-label');
    expect(el.textContent).toBe('CASE 3 OF 4 — THE ATTORNEY');
  });

  it('renders "CASE 4 OF 4 — THE JUDGE" when facing Silent on case 4', () => {
    const { getByTestId } = render(
      <CaseLabel caseNumber={4} totalCases={4} persona="Silent" />,
    );
    const el = getByTestId('case-label');
    expect(el.textContent).toBe('CASE 4 OF 4 — THE JUDGE');
  });

  it('renders "CASE DISMISSED" when caseNumber exceeds totalCases (gauntlet complete)', () => {
    // caseNumber=5 > totalCases=4 → all 4 opponents beaten
    const { getByTestId } = render(
      <CaseLabel caseNumber={5} totalCases={4} persona="Novice" />,
    );
    const el = getByTestId('case-label-dismissed');
    expect(el.textContent).toBe('CASE DISMISSED');
  });
});
