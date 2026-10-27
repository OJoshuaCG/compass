import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { CodeInput } from './code-input';

function Harness() {
  const [value, setValue] = useState('');
  return <CodeInput aria-label="Code" value={value} onValueChange={setValue} />;
}

describe('CodeInput', () => {
  it('keeps only digits, up to the length, also when pasting', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'Code' });
    await user.type(input, '12a3');
    expect(input).toHaveValue('123');
    await user.clear(input);
    await user.click(input);
    await user.paste('987 654 321');
    expect(input).toHaveValue('987654');
  });

  it('declares one-time-code autocomplete and numeric keyboard', () => {
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'Code' });
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
  });
});
