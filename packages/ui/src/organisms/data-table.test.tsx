import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';

import {
  DataTable,
  nextSort,
  type Column,
  type DataTableLabels,
  type DataTableProps,
  type TableSort,
} from './data-table';

type Row = { id: string; name: string; platform: string };

const rows: Row[] = [
  { id: '1', name: 'Ada', platform: 'GitHub' },
  { id: '2', name: 'Grace', platform: 'Slack' },
];

const columns: Column<Row>[] = [
  { id: 'name', header: 'Name', cell: (row) => row.name, sortKey: 'name' },
  { id: 'platform', header: 'Platform', cell: (row) => row.platform },
];

const labels: DataTableLabels = {
  pagination: {
    navigation: 'Pagination',
    previous: 'Previous',
    next: 'Next',
    rowsPerPage: 'Rows per page',
  },
  range: ({ from, to, total }) =>
    total === undefined
      ? `Showing ${String(from)}-${String(to)}`
      : `Showing ${String(from)}-${String(to)} of ${String(total)}`,
  actionsColumn: 'Actions',
  loading: 'Loading table data',
  retry: 'Retry',
  emptyFiltered: { title: 'No results', description: 'Nothing matches', clear: 'Clear filters' },
};

function setup(overrides: Partial<DataTableProps<Row>> = {}) {
  const props: DataTableProps<Row> = {
    columns,
    rows,
    getRowId: (row) => row.id,
    status: 'success',
    onSortChange: vi.fn(),
    limit: 25,
    onLimitChange: vi.fn(),
    pagination: { hasPrevious: false, hasNext: true, onPrevious: vi.fn(), onNext: vi.fn() },
    emptyState: <p>Nothing yet</p>,
    caption: 'Users',
    labels,
    ...overrides,
  };
  return { props, ...render(<DataTable {...props} />) };
}

describe('nextSort', () => {
  it('cycles asc, desc and none for the same column', () => {
    const first = nextSort(undefined, 'name');
    expect(first).toEqual({ key: 'name', dir: 'asc' });
    const second = nextSort(first, 'name');
    expect(second).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort(second, 'name')).toBeUndefined();
  });

  it('starts ascending when another column was sorted', () => {
    expect(nextSort({ key: 'name', dir: 'desc' }, 'platform')).toEqual({
      key: 'platform',
      dir: 'asc',
    });
  });
});

describe('DataTable semantics', () => {
  it('renders a captioned table with column headers and cells', () => {
    setup();
    const table = screen.getByRole('table', { name: 'Users' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(table).getByRole('cell', { name: 'Ada' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'Slack' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('scope', 'col');
  });

  it('only sortable columns expose a sort button and aria-sort', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Name' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Platform' })).not.toBeInTheDocument();
    const [name, platform] = screen.getAllByRole('columnheader');
    expect(name).toHaveAttribute('aria-sort', 'none');
    expect(platform).not.toHaveAttribute('aria-sort');
  });

  it.each([
    ['asc', 'ascending'],
    ['desc', 'descending'],
  ] as const)('sets aria-sort=%s on the active column', (dir, expected) => {
    setup({ sort: { key: 'name', dir } });
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('aria-sort', expected);
  });

  it('has no accessibility violations', async () => {
    const { container } = setup({ rowActions: () => <button type="button">Edit</button> });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('DataTable sorting', () => {
  function Harness({ onChange }: { onChange: (sort?: TableSort) => void }) {
    const [sort, setSort] = useState<TableSort | undefined>(undefined);
    return (
      <DataTable<Row>
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        status="success"
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          onChange(next);
        }}
        limit={25}
        onLimitChange={vi.fn()}
        pagination={{ hasPrevious: false, hasNext: false, onPrevious: vi.fn(), onNext: vi.fn() }}
        emptyState={null}
        caption="Users"
        labels={labels}
      />
    );
  }

  it('cycles ascending, descending and no sort on repeated clicks', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const header = screen.getAllByRole('columnheader')[0];
    const button = screen.getByRole('button', { name: 'Name' });

    await user.click(button);
    expect(onChange).toHaveBeenLastCalledWith({ key: 'name', dir: 'asc' });
    expect(header).toHaveAttribute('aria-sort', 'ascending');

    await user.click(button);
    expect(onChange).toHaveBeenLastCalledWith({ key: 'name', dir: 'desc' });
    expect(header).toHaveAttribute('aria-sort', 'descending');

    await user.click(button);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(header).toHaveAttribute('aria-sort', 'none');
  });

  it('sorts from the keyboard with Enter and Space', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    setup({ onSortChange });
    await user.tab(); // región desplazable
    await user.tab(); // botón del encabezado
    expect(screen.getByRole('button', { name: 'Name' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSortChange).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onSortChange).toHaveBeenCalledTimes(2);
  });
});

describe('DataTable limit and cursor pagination', () => {
  it('offers the fixed limits 10, 25, 50 and 100 and reports the change', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    const select = screen.getByRole('combobox', { name: 'Rows per page' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['10', '25', '50', '100']);
    expect(select).toHaveValue('25');
    await user.selectOptions(select, '50');
    expect(props.onLimitChange).toHaveBeenCalledWith(50);
  });

  it('disables Previous on the first page and calls onNext', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(props.pagination.onNext).toHaveBeenCalledTimes(1);
  });

  it('enables Previous on later pages and disables Next on the last one', async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn();
    setup({ pagination: { hasPrevious: true, hasNext: false, onPrevious, onNext: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('shows no page numbers, only Previous and Next', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Previous', 'Next']);
  });

  it('shows the visible range using the page offset and the total when provided', () => {
    setup({
      pagination: {
        hasPrevious: true,
        hasNext: true,
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        offset: 25,
        total: 80,
      },
    });
    expect(screen.getAllByText('Showing 26-27 of 80').length).toBeGreaterThan(0);
  });

  it('announces the range in a polite live region', () => {
    setup();
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('Showing 1-2');
  });
});

describe('DataTable states', () => {
  it('shows skeleton rows with the same columns while loading', () => {
    const { container } = setup({ status: 'loading', rows: [] });
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent('Loading table data');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('shows the empty state when there are no rows and no filters', () => {
    setup({ rows: [] });
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.queryByText('No results')).not.toBeInTheDocument();
  });

  it('shows the filtered-empty state with a clear-filters action', async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    setup({ rows: [], hasActiveFilters: true, onClearFilters });
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.queryByText('Nothing yet')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('shows the translated error message and a retry button', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    setup({ status: 'error', rows: [], errorState: { message: 'Could not load', onRetry } });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous rows and marks the table busy while refreshing', () => {
    setup({ refreshing: true });
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders row actions in an extra column with an accessible header', () => {
    setup({ rowActions: (row) => <button type="button">{`Edit ${row.name}`}</button> });
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Ada' })).toBeInTheDocument();
  });
});
