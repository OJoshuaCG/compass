import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useClientPagination } from './use-client-pagination';

function numbers(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

describe('useClientPagination', () => {
  it('shows everything in one page when the list fits, without next or previous', () => {
    const { result } = renderHook(() => useClientPagination(numbers(3)));
    expect(result.current.pageRows).toEqual([1, 2, 3]);
    expect(result.current.pagination).toMatchObject({
      hasPrevious: false,
      hasNext: false,
      total: 3,
      offset: 0,
    });
  });

  it('moves between pages and reports the offset for the range text', () => {
    const { result } = renderHook(() => useClientPagination(numbers(30)));
    expect(result.current.limit).toBe(25);
    expect(result.current.pageRows).toHaveLength(25);
    expect(result.current.pagination.hasNext).toBe(true);

    act(() => {
      result.current.pagination.onNext();
    });
    expect(result.current.pageRows).toEqual([26, 27, 28, 29, 30]);
    expect(result.current.pagination).toMatchObject({
      hasPrevious: true,
      hasNext: false,
      offset: 25,
    });

    act(() => {
      result.current.pagination.onPrevious();
    });
    expect(result.current.pagination.offset).toBe(0);
  });

  it('returns to the first page when the page size changes', () => {
    const { result } = renderHook(() => useClientPagination(numbers(60)));
    act(() => {
      result.current.pagination.onNext();
    });
    act(() => {
      result.current.onLimitChange(10);
    });
    expect(result.current.pagination.offset).toBe(0);
    expect(result.current.pageRows).toEqual(numbers(10));
  });

  it('falls back to the last existing page when the list shrinks', () => {
    let rows = numbers(30);
    const { result, rerender } = renderHook(() => useClientPagination(rows));
    act(() => {
      result.current.pagination.onNext();
    });
    expect(result.current.pagination.offset).toBe(25);

    rows = numbers(20);
    rerender();
    expect(result.current.pagination.offset).toBe(0);
    expect(result.current.pageRows).toHaveLength(20);
  });
});
