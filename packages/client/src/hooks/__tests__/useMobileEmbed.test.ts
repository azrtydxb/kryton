import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

describe('useMobileEmbed', () => {
  beforeEach(() => {
    // The hook caches its first detection in module scope (so a later URL-sync
    // that drops ?mobile= can't flip it back to false). Reset the module
    // registry between tests so each test gets a fresh, un-cached hook.
    vi.resetModules();
    setUrl('/');
  });

  it('returns false when there is no ?mobile query parameter', async () => {
    setUrl('/some/path');
    const { useMobileEmbed } = await import('../useMobileEmbed');
    const { result } = renderHook(() => useMobileEmbed());
    expect(result.current).toBe(false);
  });

  it('returns true when ?mobile=1', async () => {
    setUrl('/?mobile=1');
    const { useMobileEmbed } = await import('../useMobileEmbed');
    const { result } = renderHook(() => useMobileEmbed());
    expect(result.current).toBe(true);
  });

  it('returns true when ?mobile=true', async () => {
    setUrl('/canvas?mobile=true');
    const { useMobileEmbed } = await import('../useMobileEmbed');
    const { result } = renderHook(() => useMobileEmbed());
    expect(result.current).toBe(true);
  });

  it('keeps returning true after the ?mobile param is later dropped from the URL', async () => {
    setUrl('/?mobile=1');
    const { useMobileEmbed } = await import('../useMobileEmbed');
    const { result, rerender } = renderHook(() => useMobileEmbed());
    expect(result.current).toBe(true);
    setUrl('/some/path'); // URL sync dropped the param
    rerender();
    expect(result.current).toBe(true);
  });
});
