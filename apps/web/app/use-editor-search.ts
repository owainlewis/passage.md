"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiSearchDocs, SearchDocument, SearchScope } from "./editor-api";

type SearchState = {
  key: string;
  ownerId: string;
  documents: SearchDocument[];
  nextCursor: string;
  loading: boolean;
  error: string;
};

const emptySearch: SearchState = {
  key: "",
  ownerId: "",
  documents: [],
  nextCursor: "",
  loading: false,
  error: ""
};

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function searchError(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Search unavailable.";
}

export function normalizeEditorSearch(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function useEditorSearch({
  query,
  scope,
  userId,
  paused = false
}: {
  query: string;
  scope: SearchScope;
  userId?: string;
  paused?: boolean;
}) {
  const normalizedQuery = normalizeEditorSearch(query);
  const active = Boolean(userId && normalizedQuery);
  const invalid = [...normalizedQuery].length > 200;
  const collectionId = scope.collectionId ?? "";
  const unfiled = Boolean(scope.unfiled);
  const key = active ? `${userId}\u0000${collectionId}\u0000${unfiled}\u0000${normalizedQuery}` : "";
  const [state, setState] = useState<SearchState>(emptySearch);
  const [retryVersion, setRetryVersion] = useState(0);
  const currentKey = useRef(key);
  const requestVersion = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    currentKey.current = key;
    const version = ++requestVersion.current;
    requestController.current?.abort();
    if (!active || !userId || invalid || paused) return;

    const controller = new AbortController();
    requestController.current = controller;
    const timer = window.setTimeout(() => {
      setState((current) => ({
        key,
        ownerId: userId,
        documents: current.key === key ? current.documents : [],
        nextCursor: current.key === key ? current.nextCursor : "",
        loading: true,
        error: ""
      }));
      void apiSearchDocs(normalizedQuery, { collectionId: collectionId || undefined, unfiled }, "", controller.signal)
        .then((page) => {
          if (requestVersion.current !== version || currentKey.current !== key) return;
          setState({
            key,
            ownerId: userId,
            documents: page.documents,
            nextCursor: page.nextCursor,
            loading: false,
            error: ""
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
            error: searchError(error)
          }));
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, collectionId, invalid, key, normalizedQuery, paused, retryVersion, unfiled, userId]);

  const loadMore = useCallback(() => {
    if (!active || invalid || !userId || state.key !== key || !state.nextCursor || state.loading) return;
    const version = ++requestVersion.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const cursor = state.nextCursor;
    setState((current) => ({ ...current, loading: true, error: "" }));
    void apiSearchDocs(normalizedQuery, { collectionId: collectionId || undefined, unfiled }, cursor, controller.signal)
      .then((page) => {
        if (requestVersion.current !== version || currentKey.current !== key) return;
        setState((current) => {
          const known = new Set(current.documents.map((doc) => doc.id));
          return {
            ...current,
            documents: [...current.documents, ...page.documents.filter((doc) => !known.has(doc.id))],
            nextCursor: page.nextCursor,
            loading: false,
            error: ""
          };
        });
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        if (requestVersion.current !== version || currentKey.current !== key) return;
        setState((current) => ({ ...current, loading: false, error: searchError(error) }));
      });
  }, [active, collectionId, invalid, key, normalizedQuery, state.key, state.loading, state.nextCursor, unfiled, userId]);

  const ownsState = state.ownerId === userId;
  return {
    active,
    documents: !paused && ownsState && !invalid && state.key === key ? state.documents : [],
    errorMessage: invalid
      ? "Search is limited to 200 characters."
      : !paused && active && state.key === key
        ? state.error
        : "",
    hasMore: active && !paused && !invalid && state.key === key && Boolean(state.nextCursor),
    loading: active && !paused && !invalid && (state.key !== key || state.loading),
    loadMore,
    retry: () => setRetryVersion((version) => version + 1)
  };
}
