import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMobileEmbed } from '../useMobileEmbed';

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

describe('useMobileEmbed', () => {
  beforeEach(() => {
    setUrl('/');
  });

  it('returns false when there is no ?mobile query parameter', () => {
    setUrl('/some/path');
    const { result } = renderHook(() => useMobileEmbed());
    expect(result.current).toBe(false);
  });

  it('returns true when ?mobile=1', () => {
    setUrl('/?mobile=1');
    const { result } = renderHook(() => useMobileEmbed());
    expect(result.current).toBe(true);
  });

  it('returns true when ?mobile=true', () => {
    setUrl('/canvas?mobile=true');
    const { result } = renderHook(() => useMobileEmbed());
    expect(result.current).toBe(true);
  });
});
