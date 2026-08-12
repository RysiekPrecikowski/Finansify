export { AuthProvider } from './auth-provider';
export { getCurrentUser } from './get-current-user';

// `authProxy` is deliberately not re-exported here: `src/proxy.ts` imports it
// from `./proxy` directly, so the proxy never pulls `auth-provider.tsx` (a React
// component) into the request path.
