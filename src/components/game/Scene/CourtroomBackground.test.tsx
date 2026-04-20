// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { CourtroomBackground } from './CourtroomBackground';

afterEach(() => cleanup());

describe('CourtroomBackground', () => {
  it('renders without crashing', () => {
    const { getByTestId } = render(<CourtroomBackground />);
    expect(getByTestId('courtroom-background')).toBeDefined();
  });

  it('contains courtroom-bench semantic marker', () => {
    const { getByTestId } = render(<CourtroomBackground />);
    expect(getByTestId('courtroom-bench')).toBeDefined();
  });

  it('contains scales of justice emblem', () => {
    const { getByTestId } = render(<CourtroomBackground />);
    expect(getByTestId('courtroom-scales')).toBeDefined();
  });

  it('contains left and right column silhouettes', () => {
    const { getByTestId } = render(<CourtroomBackground />);
    expect(getByTestId('courtroom-column-left')).toBeDefined();
    expect(getByTestId('courtroom-column-right')).toBeDefined();
  });

  it('contains left and right pendant lamps', () => {
    const { getByTestId } = render(<CourtroomBackground />);
    expect(getByTestId('courtroom-lamp-left')).toBeDefined();
    expect(getByTestId('courtroom-lamp-right')).toBeDefined();
  });

  it('has pointer-events: none on the root element', () => {
    const { getByTestId } = render(<CourtroomBackground />);
    const root = getByTestId('courtroom-background') as HTMLElement;
    expect(root.style.pointerEvents).toBe('none');
  });

  it('has zIndex of 0 (does not stack above scene children)', () => {
    const { getByTestId } = render(<CourtroomBackground />);
    const root = getByTestId('courtroom-background') as HTMLElement;
    expect(root.style.zIndex).toBe('0');
  });
});
