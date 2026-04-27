import { Box, Typography } from '@mui/material';
import Config from '../../config/config';
import CurrentStatePanel from '../CurrentStatePanel';

function HomePage() {
  return (
    <Box sx={{ p: 3, color: 'white' }}>
      <Typography variant="h5" gutterBottom>
        Dashboard
      </Typography>
      <CurrentStatePanel apiUrl={Config.api.apiUrl} />
    </Box>
  );
}

export default HomePage;
