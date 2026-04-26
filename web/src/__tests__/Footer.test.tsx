import React from 'react';
import { render, screen } from '@testing-library/react';
import Footer from '../components/Footer';

test('renders version from version.json', () => {
  render(<Footer />);
  expect(screen.getByText(/v\d+\.\d+\.\d+/)).toBeInTheDocument();
});
