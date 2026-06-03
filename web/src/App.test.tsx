import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the Nakostat heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Nakostat' })).toBeInTheDocument();
  });
});
