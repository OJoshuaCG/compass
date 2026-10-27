import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '../atoms/input';

import { FormField } from './form-field';

describe('FormField', () => {
  it('associates the label with the control', () => {
    render(<FormField label="Name">{(control) => <Input {...control} />}</FormField>);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('links help text through aria-describedby', () => {
    render(
      <FormField label="Name" help="Shown in the directory">
        {(control) => <Input {...control} />}
      </FormField>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAccessibleDescription('Shown in the directory');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the control invalid and describes it by the error and the help', () => {
    render(
      <FormField label="Name" help="Shown in the directory" error="Name is required">
        {(control) => <Input {...control} />}
      </FormField>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Name is required Shown in the directory');
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
  });

  it('flags required controls', () => {
    render(
      <FormField label="Name" required>
        {(control) => <Input {...control} />}
      </FormField>,
    );
    expect(screen.getByLabelText(/Name/)).toHaveAttribute('aria-required', 'true');
  });

  it('has no aria-describedby without help or error', () => {
    render(<FormField label="Name">{(control) => <Input {...control} />}</FormField>);
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-describedby');
  });
});
