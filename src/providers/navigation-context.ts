/**
 * In-app page navigation shared by pages that link to each other.
 */

import { createContext } from 'react';

import type { PageId } from '@/lib/pages';

export interface NavigationStore {
  page: PageId;
  navigate: (page: PageId) => void;
}

export const NavigationContext = createContext<NavigationStore | null>(null);
