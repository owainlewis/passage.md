"use client";

import { useEffect, useState } from "react";
import {
  apiCreateTemplate,
  apiDeleteTemplate,
  apiTemplates,
  apiUpdateTemplate,
  Template
} from "./editor-api";

export const MAX_TEMPLATES = 10;

type PendingTemplate = {
  id: string;
  title: string;
  description: string;
  body: string;
};

export function useEditorTemplates(userId?: string) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingTemplate | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void apiTemplates()
      .then((loaded) => {
        if (!cancelled) {
          setTemplates(loaded);
          setError("");
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Templates could not be loaded");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!pending) return;
    if (!pending.title.trim()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const current = templates.find((template) => template.id === pending.id);
      if (!current) return;
      setSaving(true);
      void apiUpdateTemplate(current)
        .then((saved) => {
          if (!cancelled) {
            setTemplates((existing) => existing.map((template) => (template.id === saved.id ? saved : template)));
            setPending(null);
            setError("");
          }
        })
        .catch((reason) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : "Template could not be saved");
        })
        .finally(() => {
          if (!cancelled) setSaving(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pending, templates]);

  async function createTemplate() {
    if (templates.length >= MAX_TEMPLATES) {
      setError(`You can save up to ${MAX_TEMPLATES} templates.`);
      return null;
    }
    setSaving(true);
    try {
      const created = await apiCreateTemplate("Untitled template", "", "# Untitled\n\n");
      setTemplates((existing) => [created, ...existing]);
      setError("");
      return created;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Template could not be created");
      return null;
    } finally {
      setSaving(false);
    }
  }

  function updateTemplate(id: string, changes: Partial<Pick<Template, "title" | "description" | "body">>) {
    setTemplates((existing) =>
      existing.map((template) => (template.id === id ? { ...template, ...changes } : template))
    );
    const current = templates.find((template) => template.id === id);
    if (current) {
      setPending({
        id,
        title: changes.title ?? current.title,
        description: changes.description ?? current.description,
        body: changes.body ?? current.body
      });
    }
    setError("");
  }

  async function deleteTemplate(id: string) {
    setSaving(true);
    try {
      await apiDeleteTemplate(id);
      setTemplates((existing) => existing.filter((template) => template.id !== id));
      if (pending?.id === id) setPending(null);
      setError("");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Template could not be deleted");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    createTemplate,
    deleteTemplate,
    error,
    loading,
    saving,
    templates,
    updateTemplate
  };
}
