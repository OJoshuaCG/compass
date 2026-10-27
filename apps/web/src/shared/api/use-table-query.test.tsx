import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './api-error';
import { useTableQuery, type FetchPage, type TableSearch } from './use-table-query';

const pages: Record<string, { data: string[]; next: string | null }> = {
  first: { data: ['a', 'b'], next: 'c2' },
  c2: { data: ['c', 'd'], next: 'c3' },
  c3: { data: ['e'], next: null },
};

function setup(initial: Partial<TableSearch> = {}, fetchPage?: FetchPage<string>) {
  const fetcher: FetchPage<string> =
    fetchPage ??
    vi.fn<FetchPage<string>>((params) => {
      const page = pages[params.cursor ?? 'first'] ?? { data: [], next: null };
      return Promise.resolve({
        data: page.data,
        page: { nextCursor: page.next, limit: params.limit, total: 5 },
      });
    });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onSearchChange = vi.fn();
  const search: TableSearch = { limit: 25, ...initial };
  const hook = renderHook(
    (props: { search: TableSearch }) =>
      useTableQuery({ queryKey: ['t'], fetchPage: fetcher, search: props.search, onSearchChange }),
    { wrapper, initialProps: { search } },
  );
  return { ...hook, fetcher, onSearchChange };
}

describe('useTableQuery', () => {
  it('starts loading, then exposes rows, total and no previous page', async () => {
    const { result } = setup();
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.rows).toEqual(['a', 'b']);
    expect(result.current.pagination).toMatchObject({
      hasPrevious: false,
      hasNext: true,
      total: 5,
      offset: 0,
    });
  });

  it('walks forward with cursors and back with the in-memory stack', async () => {
    const { result, fetcher } = setup();
    await waitFor(() => {
      expect(result.current.rows).toEqual(['a', 'b']);
    });

    act(() => {
      result.current.pagination.onNext();
    });
    await waitFor(() => {
      expect(result.current.rows).toEqual(['c', 'd']);
    });
    expect(result.current.pagination).toMatchObject({
      hasPrevious: true,
      hasNext: true,
      offset: 25,
    });

    act(() => {
      result.current.pagination.onNext();
    });
    await waitFor(() => {
      expect(result.current.rows).toEqual(['e']);
    });
    expect(result.current.pagination.hasNext).toBe(false);

    act(() => {
      result.current.pagination.onPrevious();
    });
    await waitFor(() => {
      expect(result.current.rows).toEqual(['c', 'd']);
    });
    act(() => {
      result.current.pagination.onPrevious();
    });
    await waitFor(() => {
      expect(result.current.rows).toEqual(['a', 'b']);
    });
    expect(result.current.pagination.hasPrevious).toBe(false);
    expect(vi.mocked(fetcher).mock.calls.map(([p]) => p.cursor)).toEqual(
      expect.arrayContaining([undefined, 'c2', 'c3']),
    );
  });

  it('keeps the previous rows while the next page loads (no flicker)', async () => {
    let release: (() => void) | undefined;
    const slow: FetchPage<string> = (params) =>
      params.cursor === undefined
        ? Promise.resolve({ data: ['a'], page: { nextCursor: 'n', limit: 25 } })
        : new Promise((resolve) => {
            release = () => {
              resolve({ data: ['b'], page: { nextCursor: null, limit: 25 } });
            };
          });
    const { result } = setup({}, slow);
    await waitFor(() => {
      expect(result.current.rows).toEqual(['a']);
    });
    act(() => {
      result.current.pagination.onNext();
    });
    await waitFor(() => {
      expect(result.current.refreshing).toBe(true);
    });
    expect(result.current.rows).toEqual(['a']);
    expect(result.current.status).toBe('success');
    act(() => {
      release?.();
    });
    await waitFor(() => {
      expect(result.current.rows).toEqual(['b']);
    });
  });

  it('resets the cursor stack when the view signature changes', async () => {
    const { result, rerender } = setup();
    await waitFor(() => {
      expect(result.current.rows).toEqual(['a', 'b']);
    });
    act(() => {
      result.current.pagination.onNext();
    });
    await waitFor(() => {
      expect(result.current.pagination.hasPrevious).toBe(true);
    });

    rerender({ search: { limit: 25, sort: 'name', dir: 'asc' } });
    expect(result.current.pagination.hasPrevious).toBe(false);
    expect(result.current.pagination.offset).toBe(0);
  });

  it('delegates sort, limit and search changes to the URL handler', async () => {
    const { result, onSearchChange } = setup({ q: 'ad' });
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.hasActiveFilters).toBe(true);

    act(() => {
      result.current.onSortChange({ key: 'name', dir: 'desc' });
    });
    expect(onSearchChange).toHaveBeenLastCalledWith({ sort: 'name', dir: 'desc' });
    act(() => {
      result.current.onSortChange(undefined);
    });
    expect(onSearchChange).toHaveBeenLastCalledWith({ sort: undefined, dir: undefined });
    act(() => {
      result.current.onLimitChange(50);
    });
    expect(onSearchChange).toHaveBeenLastCalledWith({ limit: 50 });
    act(() => {
      result.current.onQueryChange('');
    });
    expect(onSearchChange).toHaveBeenLastCalledWith({ q: undefined });
    act(() => {
      result.current.clearFilters();
    });
    expect(onSearchChange).toHaveBeenLastCalledWith({ q: undefined });
  });

  it('exposes the sort from the URL state', async () => {
    const { result } = setup({ sort: 'name', dir: 'asc' });
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.sort).toEqual({ key: 'name', dir: 'asc' });
  });

  it('reports an error status with the ApiError and retries', async () => {
    const failure = new ApiError({ status: 500, code: 'INTERNAL', title: 'x' });
    const fetchPage = vi
      .fn<FetchPage<string>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({ data: ['ok'], page: { nextCursor: null, limit: 25 } });
    const { result } = setup({}, fetchPage);
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toBe(failure);
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.rows).toEqual(['ok']);
    });
    expect(result.current.status).toBe('success');
  });
});
