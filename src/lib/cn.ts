import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS class names, resolving conflicts in favour of the
 * caller-provided classes. The standard `cn` helper for shadcn-style codebases.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
