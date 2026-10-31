import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../api';

import { ErrorAlert } from './error-alert';
import { createI18n } from './setup';

function renderAlert(secondsLeft: number) {
  const error = new ApiError({ status: 429, code: 'RATE_LIMITED', title: 'Too many requests' });
  return render(
    <I18nextProvider i18n={createI18n('en-US')}>
      <ErrorAlert error={error} secondsLeft={secondsLeft} />
    </I18nextProvider>,
  );
}

describe('ErrorAlert', () => {
  it('keeps the countdown outside the role="alert" so it is announced only once', () => {
    renderAlert(30);
    const alert = screen.getByRole('alert');
    expect(alert).not.toHaveTextContent('30');
    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent('Try again in 30 s.');
    expect(alert).not.toContainElement(timer);
  });

  it('shows no timer when there is no wait', () => {
    renderAlert(0);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });
});
