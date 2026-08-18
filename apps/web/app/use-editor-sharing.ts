"use client";

import { Dispatch, SetStateAction, useRef, useState } from "react";
import { apiShareDoc, apiUnshareDoc, apiUpdateDoc } from "./editor-api";
import { titleOf } from "./doc-utils";
import { ALL_DOCUMENTS, Doc, DocumentFilter, newestTimestamp, SaveState, ShareState } from "./editor-model";
import { PendingSave } from "./use-editor-documents";

type EditorSharingOptions = {
  active: Doc | null;
  activeShared: boolean;
  pendingSave: PendingSave | null;
  canExport: boolean;
  canShare: boolean;
  setBillingNotice: Dispatch<SetStateAction<string>>;
  setDocs: Dispatch<SetStateAction<Doc[]>>;
  setPendingSave: Dispatch<SetStateAction<PendingSave | null>>;
  setSaveState: Dispatch<SetStateAction<SaveState>>;
  setDocumentFilter: Dispatch<SetStateAction<DocumentFilter>>;
};

export function useEditorSharing({
  active,
  activeShared,
  pendingSave,
  canExport,
  canShare,
  setBillingNotice,
  setDocs,
  setPendingSave,
  setSaveState,
  setDocumentFilter
}: EditorSharingOptions) {
  const [shareState, setShareState] = useState<ShareState>("idle");
  const copyTimer = useRef<number | undefined>(undefined);

  const publicDocPath = activeShared && active?.publicId ? `/d/${active.publicId}` : "";
  // The label names what the button does. "Shared" described a state, which
  // left no visible way to stop sharing and no route back to the link.
  const shareButtonLabel =
    shareState === "toolong"
      ? "Too long"
      : shareState === "error"
        ? "Share failed"
        : activeShared
          ? "Unshare"
          : shareState === "copied"
            ? "Copied"
            : "Share";

  function exportDoc() {
    if (!active) return;
    if (!canExport) {
      setBillingNotice("Export is a Pro feature.");
      return;
    }
    setBillingNotice("");
    const blob = new Blob([active.body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${titleOf(active.body).replace(/[^\w.-]+/g, "-").toLowerCase() || "untitled"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function shareDoc() {
    if (!active) return false;
    if (!canShare) {
      setBillingNotice("Sharing and raw .md URLs are Pro features.");
      return false;
    }
    setBillingNotice("");
    window.clearTimeout(copyTimer.current);
    try {
      if (pendingSave?.id === active.id) {
        setSaveState("saving");
        const saved = await apiUpdateDoc(pendingSave.id, pendingSave.body);
        setDocs((prev) =>
          prev.map((doc) =>
            doc.id === saved.id
              ? {
                  ...saved,
                  collectionId: doc.collectionId,
                  collectionSlug: doc.collectionSlug,
                  starred: doc.starred,
                  pinned: doc.pinned,
                  updatedAt: newestTimestamp(doc.updatedAt, saved.updatedAt)
                }
              : doc
          )
        );
        setPendingSave(null);
        setSaveState("saved");
      }
      let htmlPath = activeShared && active.publicId ? `/d/${active.publicId}` : "";
      if (!htmlPath) {
        const share = await apiShareDoc(active.id);
        const updatedAt = new Date().toISOString();
        htmlPath = share.htmlPath;
        setDocs((prev) =>
          prev.map((doc) =>
            doc.id === active.id
              ? { ...doc, publicId: share.publicId ?? doc.publicId, shareToken: share.token, sharedAt: updatedAt, updatedAt }
              : doc
          )
        );
      }
      await copyURL(new URL(htmlPath, window.location.origin).toString());
      setDocumentFilter(ALL_DOCUMENTS);
      setShareState("copied");
      copyTimer.current = window.setTimeout(() => setShareState("idle"), 1800);
      return true;
    } catch {
      setShareState("error");
      copyTimer.current = window.setTimeout(() => setShareState("idle"), 2400);
      return false;
    }
  }

  // Copying the link of an already shared document. Separate from shareDoc so
  // the link stays reachable without republishing or reopening the dialog.
  async function copyShareLink() {
    if (!publicDocPath) return false;
    window.clearTimeout(copyTimer.current);
    await copyURL(new URL(publicDocPath, window.location.origin).toString());
    setShareState("copied");
    copyTimer.current = window.setTimeout(() => setShareState("idle"), 1800);
    return true;
  }

  async function copyURL(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this share link", url);
    }
  }

  async function unshareDoc() {
    if (!active || !activeShared) return false;
    window.clearTimeout(copyTimer.current);
    try {
      await apiUnshareDoc(active.id);
      const updatedAt = new Date().toISOString();
      setDocs((prev) =>
        prev.map((doc) => (doc.id === active.id ? { ...doc, shareToken: null, sharedAt: null, updatedAt } : doc))
      );
      setDocumentFilter(ALL_DOCUMENTS);
      setShareState("unshared");
      copyTimer.current = window.setTimeout(() => setShareState("idle"), 1800);
      return true;
    } catch {
      setShareState("error");
      copyTimer.current = window.setTimeout(() => setShareState("idle"), 2400);
      return false;
    }
  }

  return {
    exportDoc,
    copyShareLink,
    publicDocPath,
    shareButtonLabel,
    shareDoc,
    shareState,
    unshareDoc
  };
}
