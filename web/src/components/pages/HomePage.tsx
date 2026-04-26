import { Box, Typography } from '@mui/material';

function HomePage() {
  return (
    <Box sx={{ p: 3, color: 'white' }}>
      <Typography variant="h5" gutterBottom>
        Dashboard
      </Typography>
      <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.6)' }}>
        Thermostat controls coming soon.
      </Typography>
    </Box>
  );
}

export default HomePage;
