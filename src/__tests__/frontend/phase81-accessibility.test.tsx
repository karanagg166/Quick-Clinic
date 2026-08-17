// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/general/StatusBadge';

describe('Phase 81: UI Accessibility & Semantic HTML Test Suite', () => {
  it('81.1 Button component provides accessible roles and respects disabled state', () => {
    render(
      <div>
        <Button aria-label="Book Appointment Now">Book Appointment</Button>
        <Button disabled aria-label="Cancel Disabled">Cancel</Button>
      </div>
    );

    const bookBtn = screen.getByRole('button', { name: 'Book Appointment Now' });
    expect(bookBtn).toBeDefined();
    expect(bookBtn.getAttribute('disabled')).toBeNull();

    const cancelBtn = screen.getByRole('button', { name: 'Cancel Disabled' });
    expect(cancelBtn).toBeDefined();
    expect(cancelBtn.hasAttribute('disabled')).toBe(true);
  });

  it('81.2 Input component renders semantic HTML with aria attributes', () => {
    render(
      <Input
        type="email"
        placeholder="Enter your email"
        aria-label="Patient Email Address"
        aria-required="true"
        required
      />
    );

    const input = screen.getByRole('textbox', { name: 'Patient Email Address' });
    expect(input).toBeDefined();
    expect(input.getAttribute('type')).toBe('email');
    expect(input.getAttribute('placeholder')).toBe('Enter your email');
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('81.3 StatusBadge renders accessible text for screen readers across various statuses', () => {
    const { rerender } = render(<StatusBadge status="confirmed" showIcon={true} />);
    expect(screen.getByText(/Confirmed/i)).toBeDefined();

    rerender(<StatusBadge status="cancelled" showIcon={true} />);
    expect(screen.getByText(/Cancelled/i)).toBeDefined();

    rerender(<StatusBadge status="completed" showIcon={true} />);
    expect(screen.getByText(/Completed/i)).toBeDefined();
  });
});
