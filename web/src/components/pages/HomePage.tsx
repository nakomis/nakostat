import { Box, Typography } from '@mui/material';
import { useAuth } from 'react-oidc-context';
import Config from '../../config/config';
import CurrentStatePanel from '../CurrentStatePanel';

function HomePage() {
  const auth = useAuth();
  return (
    <Box sx={{ p: 3, color: 'white' }}>
      <Typography variant="h5" gutterBottom>
        Dashboard
      </Typography>
      <CurrentStatePanel apiUrl={Config.api.apiUrl} accessToken={auth.user?.access_token} />
    </Box>
  );
}

export default HomePage;
