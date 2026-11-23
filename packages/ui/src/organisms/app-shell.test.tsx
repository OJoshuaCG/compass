import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppShell, SIDEBAR_ID } from './app-shell';

describe('AppShell sidebar visibility', () => {
  const renderShell = (sidebarHidden?: boolean) =>
    render(
      <AppShell
        sidebar={<nav aria-label="Main">links</nav>}
        header={<span>Compass</span>}
        skipLinkLabel="Skip"
        {...(sidebarHidden === undefined ? {} : { sidebarHidden })}
      >
        content
      </AppShell>,
    );

  it('shows the sidebar by default (backwards compatible)', () => {
    renderShell();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeVisible();
    expect(document.getElementById(SIDEBAR_ID)).not.toHaveAttribute('hidden');
  });

  it('hides the sidebar from the page and the accessibility tree but keeps the content', () => {
    renderShell(true);
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(document.getElementById(SIDEBAR_ID)).toHaveAttribute('hidden');
    expect(screen.getByRole('main')).toHaveTextContent('content');
  });
});
