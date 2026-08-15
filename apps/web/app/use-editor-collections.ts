"use client";

import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import {
  apiCollections,
  apiCreateCollection,
  apiDeleteCollection,
  apiUpdateCollection,
  apiUpdateDocMetadata,
  Collection
} from "./editor-api";
import { Doc } from "./editor-model";
import { WorkspaceCollection } from "./editor-workspace-model";

type EditorCollectionsOptions = {
  userId?: string;
  docs: Doc[];
  setDocs: Dispatch<SetStateAction<Doc[]>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useEditorCollections({ userId, docs, setDocs, setNotice }: EditorCollectionsOptions) {
  const [collections, setCollections] = useState<WorkspaceCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDocIds, setPendingDocIds] = useState<Set<string>>(() => new Set());
  const [pendingCollectionSlugs, setPendingCollectionSlugs] = useState<Set<string>>(() => new Set());
  const [creatingCollection, setCreatingCollection] = useState(false);
  const collectionVersions = useRef(new Map<string, number>());

  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollections([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setCollections([]);
    setPendingDocIds(new Set());
    setPendingCollectionSlugs(new Set());
    setCreatingCollection(false);
    collectionVersions.current = new Map();
    void apiCollections()
      .then((loaded) => {
        if (!cancelled) {
          setCollections(loaded.map(toWorkspaceCollection));
          setLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice(messageOf(error, "Collections could not be loaded"));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setNotice, userId]);

  const assignCollection = useCallback(async (documentID: string, slug: string) => {
    if (pendingDocIds.has(documentID)) return false;
    const collectionID = slug === "documents" ? null : collections.find((collection) => collection.slug === slug)?.id;
    if (slug !== "documents" && !collectionID) {
      setNotice("Collection could not be found");
      return false;
    }
    setNotice("");
    setPendingDocIds((current) => withValue(current, documentID));
    const collectionVersion = collectionVersions.current.get(slug) ?? 0;
    try {
      const saved = await apiUpdateDocMetadata(documentID, { collectionId: collectionID ?? null });
      const invalidated = (collectionVersions.current.get(slug) ?? 0) !== collectionVersion;
      setDocs((current) => current.map((doc) => doc.id === documentID
        ? invalidated
          ? { ...doc, collectionId: null, collectionSlug: null }
          : mergeConfirmedMetadata(doc, saved)
        : doc));
      return true;
    } catch (error) {
      setNotice(messageOf(error, "Document collection could not be saved"));
      return false;
    } finally {
      setPendingDocIds((current) => withoutValue(current, documentID));
    }
  }, [collections, pendingDocIds, setDocs, setNotice]);

  const toggleStar = useCallback(async (documentID: string) => {
    if (pendingDocIds.has(documentID)) return false;
    const doc = docs.find((candidate) => candidate.id === documentID);
    if (!doc) return false;
    setNotice("");
    setPendingDocIds((current) => withValue(current, documentID));
    try {
      const saved = await apiUpdateDocMetadata(documentID, { starred: !doc.starred });
      setDocs((current) => current.map((candidate) => candidate.id === documentID ? mergeConfirmedMetadata(candidate, saved) : candidate));
      return true;
    } catch (error) {
      setNotice(messageOf(error, "Document star could not be saved"));
      return false;
    } finally {
      setPendingDocIds((current) => withoutValue(current, documentID));
    }
  }, [docs, pendingDocIds, setDocs, setNotice]);

  const createCollection = useCallback(async (title: string, description: string) => {
    if (creatingCollection) return null;
    setNotice("");
    setCreatingCollection(true);
    try {
      const created = toWorkspaceCollection(await apiCreateCollection(title, description));
      setCollections((current) => [...current, created]);
      return created;
    } catch (error) {
      setNotice(messageOf(error, "Collection could not be created"));
      return null;
    } finally {
      setCreatingCollection(false);
    }
  }, [creatingCollection, setNotice]);

  const updateCollection = useCallback(async (slug: string, title: string, description: string) => {
    if (pendingCollectionSlugs.has(slug)) return false;
    setNotice("");
    setPendingCollectionSlugs((current) => withValue(current, slug));
    try {
      const saved = toWorkspaceCollection(await apiUpdateCollection(slug, title, description));
      setCollections((current) => current.map((collection) => collection.slug === slug ? saved : collection));
      return true;
    } catch (error) {
      setNotice(messageOf(error, "Collection could not be saved"));
      return false;
    } finally {
      setPendingCollectionSlugs((current) => withoutValue(current, slug));
    }
  }, [pendingCollectionSlugs, setNotice]);

  const deleteCollection = useCallback(async (slug: string) => {
    if (pendingCollectionSlugs.has(slug)) return false;
    setNotice("");
    setPendingCollectionSlugs((current) => withValue(current, slug));
    try {
      await apiDeleteCollection(slug);
      collectionVersions.current.set(slug, (collectionVersions.current.get(slug) ?? 0) + 1);
      setCollections((current) => current.filter((collection) => collection.slug !== slug));
      setDocs((current) => current.map((doc) => doc.collectionSlug === slug
        ? { ...doc, collectionId: null, collectionSlug: null }
        : doc));
      return true;
    } catch (error) {
      setNotice(messageOf(error, "Collection could not be deleted"));
      return false;
    } finally {
      setPendingCollectionSlugs((current) => withoutValue(current, slug));
    }
  }, [pendingCollectionSlugs, setDocs, setNotice]);

  return {
    assignCollection,
    collections,
    createCollection,
    creatingCollection,
    deleteCollection,
    loading,
    pendingCollectionSlugs,
    pendingDocIds,
    toggleStar,
    updateCollection
  };
}

function toWorkspaceCollection(collection: Collection): WorkspaceCollection {
  return {
    id: collection.id,
    slug: collection.slug,
    title: collection.title,
    description: collection.description ?? ""
  };
}

function mergeConfirmedMetadata(current: Doc, saved: Doc): Doc {
  return {
    ...current,
    collectionId: saved.collectionId,
    collectionSlug: saved.collectionSlug,
    starred: saved.starred,
    pinned: saved.starred
  };
}

function withValue(current: Set<string>, value: string) {
  const next = new Set(current);
  next.add(value);
  return next;
}

function withoutValue(current: Set<string>, value: string) {
  const next = new Set(current);
  next.delete(value);
  return next;
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
