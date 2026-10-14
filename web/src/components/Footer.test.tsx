import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRACKER_URL } from '@/config/config';
import versionData from '@/version.json';
import Footer from './Footer';

describe('Footer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the built version and the deployed version from the tracker', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ version: '9.8.7', commitHash: 'abc1234' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<Footer />);

    expect(screen.getByText(new RegExp(`v${versionData.version}`))).toBeInTheDocument();
    expect(await screen.findByText('deployed v9.8.7')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^${DEFAULT_TRACKER_URL}/deployments/nakostat/(sandbox|prod)/latest$`),
      ),
      expect.anything(),
    );
  });

  it('quietly omits the badge when the tracker request fails', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    render(<Footer />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText(new RegExp(`v${versionData.version}`))).toBeInTheDocument();
    expect(screen.queryByText(/deployed/)).not.toBeInTheDocument();
  });
});
