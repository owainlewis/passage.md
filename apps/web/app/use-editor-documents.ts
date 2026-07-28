"use client";

import { useEffect, useRef, useState } from "react";
import { apiArchiveDoc, apiCreateDoc, apiDocs, apiUpdateDoc } from "./editor-api";
import { docMatchesFolder } from "./editor-list";
import {
  Doc,
  isShared,
  PRIVATE_FOLDER,
  publicIdFromPath,
  SaveState,
  seedDocs,
  SHARED_FOLDER
} from "./editor-model";

export type PendingSave = {
  id: string;
  body: string;
};

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
  const [selectedFolder, setSelectedFolder] = useState(PRIVATE_FOLDER);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [billingNotice, setBillingNotice] = useState("");
  const initialURLPublicId = useRef("");

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
    (async () => {
      setSaveState("loading");
      try {
        const savedDocs = await apiDocs();
        if (cancelled) return;
        const urlDoc = savedDocs.find((doc) => doc.publicId === initialURLPublicId.current);
        setDocs(savedDocs);
        const nextActive = urlDoc ?? savedDocs[0] ?? null;
        setActiveId(nextActive?.id ?? "");
        setSelectedFolder(nextActive && isShared(nextActive) ? SHARED_FOLDER : PRIVATE_FOLDER);
        setSaveState("saved");
        setPendingSave(null);
      } catch {
        if (!cancelled) setSaveState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

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
            prev.map((doc) => (doc.id === saved.id ? { ...saved, pinned: doc.pinned } : doc))
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
    if (!userId || saveState === "loading" || !active?.publicId) return;
    const nextPath = `/write/${encodeURIComponent(active.publicId)}`;
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, "", nextPath);
    }
  }, [active?.id, active?.publicId, saveState, userId]);

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

  function selectDoc(doc: Doc) {
    setActiveId(doc.id);
    updateEditorURL(doc, "push");
  }

  async function createDoc() {
    if (docs.length >= maxSavedDocs) {
      const prefix = plan === "free" ? "Free includes" : "Your plan includes";
      setBillingNotice(`${prefix} ${maxSavedDocs} saved documents. Upgrade for more.`);
      return;
    }
    setBillingNotice("");
    setSaveState("saving");
    try {
      const doc = await apiCreateDoc("");
      setDocs((prev) => [doc, ...prev]);
      setActiveId(doc.id);
      updateEditorURL(doc, "push");
      setSelectedFolder(PRIVATE_FOLDER);
      setSaveState("saved");
      requestAnimationFrame(focusEditor);
      return doc;
    } catch (err) {
      setBillingNotice(err instanceof Error ? err.message : "Document could not be created");
      setSaveState("error");
    }
  }

  function togglePin(id: string) {
    setDocs((prev) => prev.map((doc) => (doc.id === id ? { ...doc, pinned: !doc.pinned } : doc)));
  }

  async function deleteDoc(id: string) {
    const doc = docs.find((candidate) => candidate.id === id);
    if (!doc || doc.pinned || isShared(doc)) return;
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
            prev.map((current) => (current.id === saved.id ? { ...saved, pinned: current.pinned } : current))
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
      const selectedFolderHasDocs = next.some((candidate) => docMatchesFolder(candidate, selectedFolder));
      const replacement =
        next.find((candidate) => candidate.id === activeId) ??
        next.find((candidate) => docMatchesFolder(candidate, selectedFolder)) ??
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
      if (replacement && !selectedFolderHasDocs) {
        setSelectedFolder(isShared(replacement) ? SHARED_FOLDER : PRIVATE_FOLDER);
      }
      return next;
    });
    setSaveState("saved");
  }

  return {
    active,
    activeId,
    billingNotice,
    createDoc,
    deleteDoc,
    docs,
    pendingSave,
    saveState,
    selectDoc,
    selectedFolder,
    setBillingNotice,
    setDocs,
    setPendingSave,
    setSaveState,
    setSelectedFolder,
    togglePin,
    updateBody
  };
}
