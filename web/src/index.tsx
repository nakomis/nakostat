import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './components/App';
import LoggedIn from './components/LoggedIn';
import Logout from './components/Logout';
import Outline from './Outline';
import Config from './config/config';
import { AuthProvider } from 'react-oidc-context';
import { BrowserRouter, Route, Routes } from 'react-router';

const cognitoAuthConfig = {
  authority: Config.cognito.authority,
  client_id: Config.cognito.userPoolClientId,
  redirect_uri: Config.cognito.redirectUri,
  post_logout_redirect_uri: Config.cognito.logoutUri,
  response_type: 'code',
  scope: 'email openid phone profile',
};

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <React.StrictMode>
    <Outline>
      <div className="main-content">
        <AuthProvider {...cognitoAuthConfig}>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<App />} />
              <Route path="/loggedin" element={<LoggedIn />} />
              <Route path="/logout" element={<Logout />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </div>
    </Outline>
  </React.StrictMode>,
);
