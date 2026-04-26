import { useAuth } from 'react-oidc-context';

function LoggedIn() {
  if (useAuth().isAuthenticated) {
    window.location.href = '/';
  }
  return <div />;
}

export default LoggedIn;
