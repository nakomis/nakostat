import React from 'react';
import { render } from '@testing-library/react';
import Logout from '../components/Logout';

const originalLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: '/logout' },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

test('redirects to / on render', () => {
  render(<Logout />);
  expect(window.location.href).toBe('/');
});
