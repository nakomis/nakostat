import React from 'react';
import logo from '../images/nakostat-logo.png';
import { useAuth } from 'react-oidc-context';
import './App.css';
import 'bootstrap/dist/css/bootstrap.css';
import { AppBar, Box, createTheme, ThemeProvider } from '@mui/material';
import { teal } from '@mui/material/colors';
import Config from '../config/config';
import HomePage from './pages/HomePage';
import Footer from './Footer';

const theme = createTheme({
  typography: {
    fontFamily: ['Roboto', 'Helvetica', 'Arial', 'sans-serif'].join(','),
  },
  palette: {
    primary: { main: teal[400] },
    background: { default: '#282c34', paper: '#1f2329' },
  },
});

const App: React.FC = () => {
  const auth = useAuth();

  const signOutRedirect = () => {
    const logoutUrl = `https://${Config.cognito.cognitoDomain}/logout`
      + `?client_id=${Config.cognito.userPoolClientId}`
      + `&logout_uri=${encodeURIComponent(Config.cognito.logoutUri)}`;
    auth.removeUser();
    window.location.href = logoutUrl;
  };

  if (auth.isLoading) {
    return <div className="App"><div className="App-header">Loading...</div></div>;
  }

  if (auth.error) {
    return <div className="App"><div className="App-header">Error: {auth.error.message}</div></div>;
  }

  if (auth.isAuthenticated) {
    return (
      <div className="App">
        <ThemeProvider theme={theme}>
          <AppBar position="static" sx={{ backgroundColor: '#1f2329' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1 }}>
              <img src={logo} alt="Nakostat" style={{ height: 36, marginRight: 12 }} />
              <span style={{ color: 'white', fontWeight: 500, fontSize: '1.1rem', flexGrow: 1 }}>
                Nakostat
              </span>
              <button
                type="button"
                className="btn btn-outline-light btn-sm"
                onClick={signOutRedirect}
              >
                Sign out
              </button>
            </Box>
          </AppBar>
          <HomePage />
        </ThemeProvider>
        <Footer />
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="Nakostat logo" />
        <p>Nakostat</p>
        <p style={{ fontSize: '0.6em', color: 'rgba(255,255,255,0.6)' }}>
          Smart thermostat dashboard
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => auth.signinRedirect()}
        >
          Sign in
        </button>
      </header>
      <Footer />
    </div>
  );
};

export default App;
