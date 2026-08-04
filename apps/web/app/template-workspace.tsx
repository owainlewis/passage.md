"use client";

import { useState } from "react";
import { Template } from "./editor-api";
import { Mode } from "./editor-model";
import { MarkdownView } from "./markdown-view";
import { MAX_TEMPLATES } from "./use-editor-templates";

type TemplateWorkspaceProps = {
  activeTemplateId: string;
  darkActive: boolean;
  error: string;
  loading: boolean;
  saving: boolean;
  templates: Template[];
  onCreateDocument: (body: string) => Promise<boolean>;
  onCreateTemplate: () => Promise<Template | null>;
  onDeleteTemplate: (id: string) => Promise<boolean>;
  onEditTemplate: (id: string) => void;
  onShowLibrary: () => void;
  onUpdateTemplate: (id: string, changes: Partial<Pick<Template, "title" | "body">>) => void;
};

export function TemplateWorkspace({
  activeTemplateId,
  darkActive,
  error,
  loading,
  saving,
  templates,
  onCreateDocument,
  onCreateTemplate,
  onDeleteTemplate,
  onEditTemplate,
  onShowLibrary,
  onUpdateTemplate
}: TemplateWorkspaceProps) {
  const [mode, setMode] = useState<Mode>("edit");
  const activeTemplate = templates.find((template) => template.id === activeTemplateId) ?? null;

  function confirmDelete(template: Template, onDeleted?: () => void) {
    if (!window.confirm(`Delete “${template.title}”? This cannot be undone.`)) return;
    void onDeleteTemplate(template.id).then((deleted) => {
      if (deleted) onDeleted?.();
    });
  }

  if (activeTemplate) {
    return (
      <section className="templateEditor" aria-label="Template editor">
        <div className="templateEditorHead">
          <button type="button" className="textButton" aria-label="Back to templates" onClick={onShowLibrary}>
            <span aria-hidden="true">←</span> Templates
          </button>
          <input
            className="templateTitleInput"
            aria-label="Template title"
            value={activeTemplate.title}
            maxLength={120}
            onChange={(event) => onUpdateTemplate(activeTemplate.id, { title: event.target.value })}
            onBlur={(event) => {
              if (!event.target.value.trim()) onUpdateTemplate(activeTemplate.id, { title: "Untitled template" });
            }}
          />
          <button
            type="button"
            className="templateDelete"
            aria-label={`Delete ${activeTemplate.title}`}
            disabled={saving}
            onClick={() => confirmDelete(activeTemplate, onShowLibrary)}
          >
            Delete
          </button>
        </div>

        <div className="templateEditorBody">
          {mode === "edit" ? (
            <textarea
              className="editor templateBodyInput"
              aria-label="Template Markdown"
              aria-multiline="true"
              spellCheck
              placeholder="Write the Markdown this template should copy."
              value={activeTemplate.body}
              onChange={(event) => onUpdateTemplate(activeTemplate.id, { body: event.target.value })}
            />
          ) : (
            <MarkdownView source={activeTemplate.body} theme={darkActive ? "dark" : "light"} />
          )}
        </div>

        <footer className="templateEditorFoot">
          <div className="modeToggle" role="group" aria-label="Template view mode">
            <button type="button" className={mode === "edit" ? "on" : ""} aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>
              Edit
            </button>
            <button type="button" className={mode === "preview" ? "on" : ""} aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>
              Preview
            </button>
          </div>
          <span className="templateSaveState">{error || (saving ? "Saving" : "Saved")}</span>
        </footer>
      </section>
    );
  }

  return (
    <section className="templateLibrary" aria-labelledby="templates-title">
      <div className="templateLibraryHead">
        <div>
          <h2 id="templates-title">Create from a template</h2>
          <p>Choose a starting point or make your own.</p>
        </div>
        <div className="templateLibraryActions">
          <span>{templates.length} of {MAX_TEMPLATES}</span>
          <button
            type="button"
            className="templateNewButton"
            aria-label="New template"
            disabled={loading || saving || templates.length >= MAX_TEMPLATES}
            onClick={() => void onCreateTemplate().then((created) => {
              if (created) {
                setMode("edit");
                onEditTemplate(created.id);
              }
            })}
          >
            <span aria-hidden="true">+</span> New template
          </button>
        </div>
      </div>

      {error && <p className="templateError" role="alert">{error}</p>}
      {loading ? (
        <div className="pendingStatus" role="status" aria-label="Loading templates" />
      ) : (
        <div className="templateGrid">
          <article className="templateCard templateCardBlank">
            <div>
              <h3>Blank document</h3>
              <p>Start with an empty Markdown page.</p>
            </div>
            <div className="templateCardActions">
              <button type="button" className="btnPrimary" aria-label="Create blank document" onClick={() => void onCreateDocument("")}>
                Create blank
              </button>
            </div>
          </article>

          {templates.map((template) => (
            <article className="templateCard" key={template.id}>
              <div>
                <h3>{template.title}</h3>
                <p>{templateExcerpt(template.body)}</p>
              </div>
              <div className="templateCardActions">
                <button
                  type="button"
                  className="btnPrimary"
                  aria-label={`Create document from ${template.title}`}
                  onClick={() => void onCreateDocument(template.body)}
                >
                  Use template
                </button>
                <button
                  type="button"
                  className="textButton"
                  aria-label={`Edit ${template.title}`}
                  onClick={() => { setMode("edit"); onEditTemplate(template.id); }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="templateCardDelete"
                  aria-label={`Delete ${template.title}`}
                  disabled={saving}
                  onClick={() => confirmDelete(template)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}

        </div>
      )}
    </section>
  );
}

function templateExcerpt(body: string) {
  const text = body
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/[#>*_`\[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Empty Markdown template.";
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}
