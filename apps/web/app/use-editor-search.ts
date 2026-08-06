"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiSearchDocs, SearchDocument } from "./editor-api";
import { DocumentFilter } from "./editor-model";

type SearchState = {
  key: string;
  ownerId: string;
  documents: SearchDocument[];
  nextCursor: string;
  loading: boolean;
  error: boolean;
};

const emptySearch: SearchState = {
  key: "",
  ownerId: "",
  documents: [],
  nextCursor: "",
  loading: false,
  error: false
};

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function normalizeEditorSearch(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function useEditorSearch({
  query,
  visibility,
  userId,
  mutationVersion
}: {
  query: string;
  visibility: DocumentFilter;
  userId?: string;
  mutationVersion: number;
}) {
  const normalizedQuery = normalizeEditorSearch(query);
  const active = Boolean(userId && normalizedQuery);
  const key = active ? `${userId}\u0000${visibility}\u0000${normalizedQuery}` : "";
  const [state, setState] = useState<SearchState>(emptySearch);
  const [retryVersion, setRetryVersion] = useState(0);
  const currentKey = useRef(key);
  const requestVersion = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    currentKey.current = key;
    const version = ++requestVersion.current;
    requestController.current?.abort();
    if (!active || !userId) return;

    const controller = new AbortController();
    requestController.current = controller;
    const timer = window.setTimeout(() => {
      setState((current) => ({
        key,
        ownerId: userId,
        documents: current.ownerId === userId ? current.documents : [],
        nextCursor: current.key === key ? current.nextCursor : "",
        loading: true,
        error: false
      }));
      void apiSearchDocs(normalizedQuery, visibility, "", controller.signal)
        .then((page) => {
          if (requestVersion.current !== version || currentKey.current !== key) return;
          setState({
            key,
            ownerId: userId,
            documents: page.documents,
            nextCursor: page.nextCursor,
            loading: false,
            error: false
          });
        })
        .catch((error: unknown) => {
          if (isAbortError(error)) return;
          if (requestVersion.current !== version || currentKey.current !== key) return;
          setState((current) => ({
            ...current,
            key,
            ownerId: userId,
            loading: false,
            error: true
          }));
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, key, mutationVersion, normalizedQuery, retryVersion, userId, visibility]);

  const loadMore = useCallback(() => {
    if (!active || !userId || state.key !== key || !state.nextCursor || state.loading) return;
    const version = ++requestVersion.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const cursor = state.nextCursor;
    setState((current) => ({ ...current, loading: true, error: false }));
    void apiSearchDocs(normalizedQuery, visibility, cursor, controller.signal)
      .then((page) => {
        if (requestVersion.current !== version || currentKey.current !== key) return;
        setState((current) => {
          const known = new Set(current.documents.map((doc) => doc.id));
          return {
            ...current,
            documents: [...current.documents, ...page.documents.filter((doc) => !known.has(doc.id))],
            nextCursor: page.nextCursor,
            loading: false,
            error: false
          };
        });
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        if (requestVersion.current !== version || currentKey.current !== key) return;
        setState((current) => ({ ...current, loading: false, error: true }));
      });
  }, [active, key, normalizedQuery, state.key, state.loading, state.nextCursor, userId, visibility]);

  const ownsState = state.ownerId === userId;
  return {
    active,
    documents: ownsState ? state.documents : [],
    error: active && state.key === key && state.error,
    hasMore: active && state.key === key && Boolean(state.nextCursor),
    loading: active && (state.key !== key || state.loading),
    loadMore,
    retry: () => setRetryVersion((version) => version + 1)
  };
}
