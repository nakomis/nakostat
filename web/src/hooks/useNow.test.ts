import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNow } from './useNow';

describe('useNow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks', () => {
    vi.setSystemTime(1_000_000);
    const { result } = renderHook(() => useNow(1000));
    expect(result.current).toBe(1_000_000);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1_001_000);
  });
});
