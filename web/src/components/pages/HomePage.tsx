import { Box, Typography } from '@mui/material';
import { useMemo } from 'react';
import { useAuth } from 'react-oidc-context';
import Config from '../../config/config';
import CurrentStatePanel from '../CurrentStatePanel';
import { createApiClient } from '../../services/api';

function HomePage() {
  const auth = useAuth();
  const accessToken = auth.user?.access_token;
  const api = useMemo(
    () => createApiClient(Config.api.apiUrl, accessToken),
    [accessToken],
  );
  return (
    <Box sx={{ p: 3, color: 'white' }}>
      <Typography variant="h5" gutterBottom>
        Dashboard
      </Typography>
      <CurrentStatePanel api={api} />
    </Box>
  );
}

export default HomePage;
