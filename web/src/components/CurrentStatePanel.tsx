import { Card, CardContent, Typography, Chip, CircularProgress, Box } from '@mui/material';
import { useEffect, useState } from 'react';

interface ThermostatState {
  deviceId: string;
  boilerActive?: boolean;
  setpoint?: number;
  mode?: string;
  updatedAt?: string;
}

interface CurrentStatePanelProps {
  apiUrl: string;
  accessToken?: string;
}

function CurrentStatePanel({ apiUrl, accessToken }: CurrentStatePanelProps) {
  const [state, setState] = useState<ThermostatState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const headers: HeadersInit = accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : {};
    fetch(`${apiUrl}/state`, { headers })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ThermostatState>;
      })
      .then(data => {
        setState(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [apiUrl, accessToken]);

  return (
    <Card sx={{ backgroundColor: '#2c313a', color: 'white', mb: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>Current State</Typography>
        {loading && <CircularProgress size={24} />}
        {error && (
          <Typography color="error">Error: {error}</Typography>
        )}
        {!loading && !error && !state && (
          <Typography sx={{ color: 'rgba(255,255,255,0.6)' }}>No data</Typography>
        )}
        {!loading && !error && state && (
          <Box>
            <Box sx={{ mb: 1 }}>
              <Chip
                label={state.boilerActive ? 'Boiler On' : 'Boiler Off'}
                color={state.boilerActive ? 'error' : 'default'}
                size="small"
              />
            </Box>
            {state.setpoint !== undefined && (
              <Typography variant="body2">Setpoint: {state.setpoint}°C</Typography>
            )}
            {state.mode && (
              <Typography variant="body2">Mode: {state.mode}</Typography>
            )}
            {state.updatedAt && (
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', mt: 1 }}>
                Updated: {new Date(state.updatedAt).toLocaleString()}
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export default CurrentStatePanel;
