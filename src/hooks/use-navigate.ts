import { useContext } from 'react';

import { NavigationContext } from '@/providers/navigation-context';
import type { PageId } from '@/lib/pages';

/** Returns a function that switches the active page. */
export function useNavigate(): (page: PageId) => void {
  const context = useContext(NavigationContext);

  if (!context) {
    throw new Error('useNavigate() must be used inside the application shell');
  }

  return context.navigate;
}
