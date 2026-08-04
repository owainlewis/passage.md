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

  if (activeTemplate) {
    return (
      <section className="templateEditor" aria-label="Template editor">
        <div className="templateEditorHead">
          <button type="button" className="textButton" onClick={onShowLibrary}>
            Back to templates
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
            onClick={() => void onDeleteTemplate(activeTemplate.id).then((deleted) => deleted && onShowLibrary())}
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
          <button type="button" className="btnPrimary" onClick={() => void onCreateDocument(activeTemplate.body)}>
            Create document
          </button>
        </footer>
      </section>
    );
  }

  return (
    <section className="templateLibrary" aria-labelledby="templates-title">
      <div className="templateLibraryHead">
        <div>
          <h2 id="templates-title">Create a document</h2>
          <p>Start blank or copy the Markdown from one of your templates.</p>
        </div>
        <span>{templates.length} of {MAX_TEMPLATES} templates</span>
      </div>

      {error && <p className="templateError" role="alert">{error}</p>}
      {loading ? (
        <div className="pendingStatus" role="status" aria-label="Loading templates" />
      ) : (
        <div className="templateGrid">
          <article className="templateCard templateCardBlank">
            <div>
              <span className="templateCardType">Document</span>
              <h3>Blank document</h3>
              <p>Start with an empty Markdown page.</p>
            </div>
            <button type="button" className="btnPrimary" onClick={() => void onCreateDocument("")}>
              Create blank document
            </button>
          </article>

          {templates.map((template) => (
            <article className="templateCard" key={template.id}>
              <div>
                <span className="templateCardType">Template</span>
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
                  Create from template
                </button>
                <button
                  type="button"
                  className="textButton"
                  aria-label={`Edit ${template.title}`}
                  onClick={() => { setMode("edit"); onEditTemplate(template.id); }}
                >
                  Edit
                </button>
              </div>
            </article>
          ))}

          <button
            type="button"
            className="templateCard templateCardNew"
            aria-label="New template"
            disabled={saving || templates.length >= MAX_TEMPLATES}
            onClick={() => void onCreateTemplate().then((created) => {
              if (created) {
                setMode("edit");
                onEditTemplate(created.id);
              }
            })}
          >
            <span className="templateCardPlus">+</span>
            <span>New template</span>
          </button>
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
