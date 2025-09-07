/**
 * Search Hook
 * Handles debounced search functionality
 */

import { useState, useEffect, useCallback } from 'react';

export interface UseSearchOptions {
  debounceMs?: number;
  onSearch?: (query: string) => void;
}

export interface UseSearchReturn {
  query: string;
  setQuery: (query: string) => void;
  debouncedQuery: string;
  isSearching: boolean;
}

export function useSearch({
  debounceMs = 300,
  onSearch
}: UseSearchOptions = {}): UseSearchReturn {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Debounce the search query
  useEffect(() => {
    if (query !== debouncedQuery) {
      setIsSearching(true);
    }

    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setIsSearching(false);
      
      if (onSearch) {
        onSearch(query);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, debounceMs, onSearch, debouncedQuery]);

  return {
    query,
    setQuery: useCallback((newQuery: string) => setQuery(newQuery), []),
    debouncedQuery,
    isSearching
  };
}