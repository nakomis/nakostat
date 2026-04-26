import React from 'react';
import { render, screen } from '@testing-library/react';
import HomePage from '../components/pages/HomePage';

test('renders dashboard heading', () => {
  render(<HomePage />);
  expect(screen.getByText('Dashboard')).toBeInTheDocument();
});
