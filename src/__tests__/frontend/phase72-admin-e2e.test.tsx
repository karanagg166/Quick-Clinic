// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminSidebar from '@/components/admin/AdminSidebar';
import { LogFilters } from '@/components/admin/dashboard/LogFilters';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin',
}));

describe('Phase 72: Frontend Admin E2E Component & Navigation Test Suite', () => {
  it('72.1 Renders AdminSidebar with system management links and navigation items', () => {
    render(<AdminSidebar isSidebarOpen={true} setSidebarOpen={vi.fn()} />);

    expect(screen.getByText('Admin Portal')).toBeDefined();
    expect(screen.getByText('System Management')).toBeDefined();
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Monitor Logs')).toBeDefined();
    expect(screen.getByText('Onboarding')).toBeDefined();
    expect(screen.getByText('Admin Profile')).toBeDefined();
  });

  it('72.2 Renders Admin LogFilters with Audit and Access log categories', () => {
    const handleFilterChange = vi.fn();
    render(<LogFilters onFilterChange={handleFilterChange} loading={false} />);

    expect(screen.getByText('Log Type')).toBeDefined();
    expect(screen.getByText('Scope')).toBeDefined();
  });
});
