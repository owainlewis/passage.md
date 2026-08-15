"use client";

import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { apiArchiveDoc, apiCreateDoc, apiDoc, apiDocsPage, apiUpdateDoc } from "./editor-api";
import { docMatchesFilter } from "./editor-list";
import {
  ALL_DOCUMENTS,
  Doc,
  DocumentFilter,
  isShared,
  publicIdFromPath,
  SaveState,
  seedDocs
} from "./editor-model";

export type PendingSave = {
  id: string;
  body: string;
};

export type BillingNoticeAction = "upgrade" | "limit" | null;

type EditorDocumentsOptions = {
  userId?: string;
  maxSavedDocs: number;
  plan: string;
  focusEditor: () => void;
};

export function useEditorDocuments({
  userId,
  maxSavedDocs,
  plan,
  focusEditor
}: EditorDocumentsOptions) {
  const [docs, setDocs] = useState<Doc[]>(seedDocs);
  const [activeId, setActiveId] = useState("welcome");
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>(ALL_DOCUMENTS);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [billingNotice, setBillingNoticeMessage] = useState("");
  const [billingNoticeAction, setBillingNoticeAction] = useState<BillingNoticeAction>(null);
  const [nextCursor, setNextCursor] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [documentLoadError, setDocumentLoadError] = useState("");
  const initialURLPublicId = useRef("");
  const activeRequest = useRef(0);
  const bodyRequests = useRef(new Set<string>());
  const accountGeneration = useRef(0);

  const setBillingNotice: Dispatch<SetStateAction<string>> = useCallback((value) => {
    setBillingNoticeAction(null);
    setBillingNoticeMessage(value);
  }, []);

  useEffect(() => {
    initialURLPublicId.current = publicIdFromPath();
  }, []);

  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingSave(null);
      return;
    }
    let cancelled = false;
    const generation = ++accountGeneration.current;
    (async () => {
      setSaveState("loading");
      setNextCursor("");
      setLoadingMore(false);
      try {
        const firstPage = await apiDocsPage();
        let savedDocs = firstPage.documents;
        let cursor = firstPage.nextCursor;
        while (initialURLPublicId.current && !savedDocs.some((doc) => doc.publicId === initialURLPublicId.current) && cursor) {
          const page = await apiDocsPage(cursor);
          savedDocs = [...savedDocs, ...page.documents];
          cursor = page.nextCursor;
        }
        if (cancelled) return;
        const urlDoc = savedDocs.find((doc) => doc.publicId === initialURLPublicId.current);
        const nextActive = urlDoc ?? savedDocs[0] ?? null;
        setDocs(savedDocs);
        setNextCursor(cursor);
        setActiveId(nextActive?.id ?? "");
        setDocumentFilter(ALL_DOCUMENTS);
        setSaveState("saved");
        setPendingSave(null);
        setLoadingMore(Boolean(cursor));
        while (cursor && !cancelled) {
          try {
            const page = await apiDocsPage(cursor);
            if (cancelled || accountGeneration.current !== generation) return;
            setDocs((prev) => {
              const known = new Set(prev.map((doc) => doc.id));
              return [...prev, ...page.documents.filter((doc) => !known.has(doc.id))];
            });
            cursor = page.nextCursor;
            setNextCursor(cursor);
          } catch {
            if (cancelled || accountGeneration.current !== generation) return;
            setBillingNotice("Some documents could not be indexed. Load the next page to try again.");
            break;
          }
        }
        if (!cancelled) setLoadingMore(false);
      } catch {
        if (!cancelled) setSaveState("error");
      }
    })();
    return () => {
      cancelled = true;
      accountGeneration.current += 1;
    };
  }, [setBillingNotice, userId]);

  const loadDocBody = useCallback(async (doc: Doc) => {
    if (doc.bodyLoaded || bodyRequests.current.has(doc.id)) return;
    bodyRequests.current.add(doc.id);
    const request = ++activeRequest.current;
    setDocumentLoadError("");
    try {
      const loaded = await apiDoc(doc.id);
      setDocs((prev) => prev.map((candidate) => (candidate.id === loaded.id ? { ...candidate, ...loaded } : candidate)));
    } catch {
      if (activeRequest.current === request) {
        setDocumentLoadError(doc.id);
      }
    } finally {
      bodyRequests.current.delete(doc.id);
    }
  }, []);

  useEffect(() => {
    if (!userId || !pendingSave) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setSaveState("saving");
        try {
          const saved = await apiUpdateDoc(pendingSave.id, pendingSave.body);
          if (cancelled) return;
          setDocs((prev) =>
            prev.map((doc) =>
              doc.id === saved.id
                ? {
                    ...saved,
                    collectionId: doc.collectionId,
                    collectionSlug: doc.collectionSlug,
                    starred: doc.starred,
                    pinned: doc.pinned
                  }
                : doc
            )
          );
          setSaveState("saved");
          setPendingSave(null);
        } catch {
          if (!cancelled) setSaveState("error");
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pendingSave, userId]);

  const active = docs.find((doc) => doc.id === activeId) ?? docs[0] ?? null;

  useEffect(() => {
    if (userId && active && !active.bodyLoaded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadDocBody(active);
    }
  }, [active, loadDocBody, userId]);

  function updateBody(body: string) {
    if (!active) return;
    setSaveState("saving");
    setPendingSave({ id: active.id, body });
    setDocs((prev) => prev.map((doc) => (doc.id === active.id ? { ...doc, body } : doc)));
  }

  function updateEditorURL(doc: Doc, mode: "push" | "replace") {
    if (!doc.publicId) return;
    const nextPath = `/write/${encodeURIComponent(doc.publicId)}`;
    if (window.location.pathname === nextPath) return;
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", nextPath);
  }

  function selectDoc(doc: Doc, history: "push" | "replace" | "none" = "push") {
    setActiveId(doc.id);
    if (history !== "none") updateEditorURL(doc, history);
    void loadDocBody(doc);
  }

  async function loadMoreDocs() {
    if (!nextCursor || loadingMore) return;
    const generation = accountGeneration.current;
    setLoadingMore(true);
    try {
      const page = await apiDocsPage(nextCursor);
      if (accountGeneration.current !== generation) return;
      setDocs((prev) => {
        const known = new Set(prev.map((doc) => doc.id));
        return [...prev, ...page.documents.filter((doc) => !known.has(doc.id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      if (accountGeneration.current !== generation) return;
      setSaveState("error");
    } finally {
      if (accountGeneration.current === generation) setLoadingMore(false);
    }
  }

  async function createDoc(body = "") {
    if (docs.length >= maxSavedDocs) {
      showDocumentLimit();
      return;
    }
    setBillingNotice("");
    setSaveState("saving");
    try {
      const doc = await apiCreateDoc(body);
      setDocs((prev) => [doc, ...prev]);
      setActiveId(doc.id);
      updateEditorURL(doc, "push");
      setDocumentFilter(ALL_DOCUMENTS);
      setSaveState("saved");
      requestAnimationFrame(focusEditor);
      return doc;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Document could not be created";
      if (message.includes("saved document limit reached")) {
        showDocumentLimit();
        setSaveState("saved");
      } else {
        setBillingNotice(message);
        setSaveState("error");
      }
    }
  }

  function showDocumentLimit() {
    setBillingNoticeAction(plan === "free" ? "upgrade" : "limit");
    if (plan === "free") {
      setBillingNoticeMessage(`Free includes ${maxSavedDocs} saved documents. Upgrade for more.`);
      return;
    }
    setBillingNoticeMessage(
      `You've reached your ${new Intl.NumberFormat("en-US").format(maxSavedDocs)} saved-document limit. Request a reviewed limit increase.`
    );
  }

  async function deleteDoc(id: string) {
    const doc = docs.find((candidate) => candidate.id === id);
    if (!doc || isShared(doc)) return;
    const cancelledSave = pendingSave?.id === id ? pendingSave : null;
    if (cancelledSave) setPendingSave(null);
    setSaveState("saving");
    try {
      await apiArchiveDoc(id);
    } catch {
      if (cancelledSave) {
        try {
          const saved = await apiUpdateDoc(cancelledSave.id, cancelledSave.body);
          setDocs((prev) =>
            prev.map((current) =>
              current.id === saved.id
                ? {
                    ...saved,
                    collectionId: current.collectionId,
                    collectionSlug: current.collectionSlug,
                    starred: current.starred,
                    pinned: current.pinned
                  }
                : current
            )
          );
        } catch {
          // The error state below covers both the failed deletion and failed save recovery.
        }
      }
      setSaveState("error");
      return;
    }
    setDocs((prev) => {
      const next = prev.filter((candidate) => candidate.id !== id);
      const filteredDocsRemain = next.some((candidate) => docMatchesFilter(candidate, documentFilter));
      const replacement =
        next.find((candidate) => candidate.id === activeId) ??
        next.find((candidate) => docMatchesFilter(candidate, documentFilter)) ??
        next[0] ??
        null;
      if (id === activeId) {
        setActiveId(replacement?.id ?? "");
        if (replacement) {
          updateEditorURL(replacement, "replace");
        } else {
          window.history.replaceState(null, "", "/write");
        }
      }
      if (replacement && !filteredDocsRemain) {
        setDocumentFilter(ALL_DOCUMENTS);
      }
      return next;
    });
    setSaveState("saved");
  }

  return {
    active,
    activeLoadError: Boolean(active && !active.bodyLoaded && documentLoadError === active.id),
    activeLoading: Boolean(active && !active.bodyLoaded && documentLoadError !== active.id),
    activeId,
    billingNotice,
    billingNoticeAction,
    createDoc,
    deleteDoc,
    docs,
    hasMoreDocs: Boolean(nextCursor),
    loadMoreDocs,
    loadingMore,
    pendingSave,
    retryActive: () => {
      if (active) void loadDocBody(active);
    },
    saveState,
    selectDoc,
    documentFilter,
    setBillingNotice,
    setDocs,
    setPendingSave,
    setSaveState,
    setDocumentFilter,
    updateBody
  };
}
