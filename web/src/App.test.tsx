import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the Nakostat heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Nakostat' })).toBeInTheDocument();
  });

  it('renders themed shadcn components', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByText('Boiler On')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});
