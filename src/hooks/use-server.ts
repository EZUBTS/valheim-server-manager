import { useContext } from 'react';

import { ServerContext, type ServerStore } from '@/providers/server-context';

/** Access the application store; throws when used outside `ServerProvider`. */
export function useServer(): ServerStore {
  const store = useContext(ServerContext);

  if (!store) {
    throw new Error('useServer() must be used inside <ServerProvider>');
  }

  return store;
}
