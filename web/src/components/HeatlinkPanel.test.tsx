import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HeatlinkStatus } from '@/api/contract';
import HeatlinkPanel from './HeatlinkPanel';

const now = Date.parse('2026-10-19T10:00:00Z');
const status: HeatlinkStatus = {
  mode: 'auto',
  relay: true,
  switch: 'auto',
  seen: '2026-10-19T09:59:00Z',
  version: '1.2.3',
};

describe('HeatlinkPanel', () => {
  it('shows a placeholder when nothing has been seen', () => {
    render(<HeatlinkPanel status={null} now={now} />);
    expect(screen.getByText(/not reported/)).toBeInTheDocument();
  });

  it('renders mode, switch, relay, last seen and version', () => {
    render(<HeatlinkPanel status={status} now={now} />);
    expect(screen.getByText(/Auto \(following/)).toBeInTheDocument();
    expect(screen.getByText('auto')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('1 min ago')).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns when stale', () => {
    render(<HeatlinkPanel status={{ ...status, seen: '2026-10-19T09:50:00Z' }} now={now} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Last heard from 10 min ago/);
  });

  it('warns in fallback mode', () => {
    render(<HeatlinkPanel status={{ ...status, mode: 'fallback', relay: false }} now={now} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/fallback schedule/);
    expect(screen.getByText('Off')).toBeInTheDocument();
  });
});
