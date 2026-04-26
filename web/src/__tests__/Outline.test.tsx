import React from 'react';
import { render, screen } from '@testing-library/react';
import Outline from '../Outline';

test('renders children inside outline wrapper', () => {
  render(<Outline><span>hello</span></Outline>);
  expect(screen.getByText('hello')).toBeInTheDocument();
});
