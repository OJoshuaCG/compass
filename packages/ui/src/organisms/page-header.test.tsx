import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from './page-header';

describe('PageHeader', () => {
  it('renders the title as the level one heading', () => {
    render(<PageHeader title="Users" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
  });

  it('shows the optional eyebrow, description and actions', () => {
    render(
      <PageHeader
        title="Users"
        eyebrow="Workspace"
        description="People in your organization"
        actions={<button type="button">Invite</button>}
      />,
    );
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('People in your organization')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });

  it('omits the optional parts when they are not given', () => {
    render(<PageHeader title="Users" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByText(/./)).toHaveLength(1);
  });
});
