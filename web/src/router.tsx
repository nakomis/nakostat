import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import Home from '@/routes/Home';
import LoggedIn from '@/routes/LoggedIn';
import Logout from '@/routes/Logout';
import Schedule from '@/routes/Schedule';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
});

const loggedInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/loggedin',
  component: LoggedIn,
});

const scheduleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/schedule',
  component: Schedule,
});

const logoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logout',
  component: Logout,
});

const routeTree = rootRoute.addChildren([indexRoute, scheduleRoute, loggedInRoute, logoutRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
