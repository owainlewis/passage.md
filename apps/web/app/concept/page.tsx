"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "../brand";
import { MarkdownView } from "../markdown-view";
import styles from "./workspace.module.css";

type Collection = {
  slug: string;
  title: string;
  description: string;
  kind: "context" | "work";
  accent: string;
  context?: string[];
  agentAccess: string;
};

type WorkspaceDocument = {
  id: string;
  collection: string;
  path: string;
  title: string;
  summary: string;
  body: string;
  starred: boolean;
  updatedLabel: string;
  updatedOrder: number;
  status?: "Draft" | "In review" | "Approved" | "Published";
};

type View =
  | { type: "home" }
  | { type: "starred" }
  | { type: "recent" }
  | { type: "collections" }
  | { type: "collection"; slug: string }
  | { type: "document"; id: string };

const collections: Collection[] = [
  {
    slug: "operating-context",
    title: "Operating Context",
    description: "The stable source of truth about your goals, products, audience, and ways of working.",
    kind: "context",
    accent: "#d86f45",
    agentAccess: "Agents can read. Changes require approval."
  },
  {
    slug: "content-studio",
    title: "Content Studio",
    description: "Ideas, research, drafts, and finished work produced by you and your agents.",
    kind: "work",
    accent: "#768d6b",
    context: ["operating-context"],
    agentAccess: "Writer agents can create and edit drafts."
  },
  {
    slug: "passage",
    title: "Passage",
    description: "Product direction, decisions, customer notes, and technical specifications.",
    kind: "context",
    accent: "#8b7ca8",
    agentAccess: "Product agents can read and propose edits."
  },
  {
    slug: "research",
    title: "Research",
    description: "Source notes and useful references gathered during active work.",
    kind: "work",
    accent: "#4f8291",
    context: ["operating-context"],
    agentAccess: "Research agents can add new source notes."
  }
];

const initialDocuments: WorkspaceDocument[] = [
  {
    id: "about-me",
    collection: "operating-context",
    path: "about-me.md",
    title: "About me",
    summary: "Background, strengths, interests, and the work I want to spend time on.",
    body: "# About me\n\nI am a software engineer, educator, and product builder based in the UK.\n\n## What I care about\n\n- Making powerful technology understandable\n- Building small, useful software\n- Helping people work well with coding agents\n\n## Current focus\n\nBuild products and teaching material that make agent workflows practical for independent builders.",
    starred: true,
    updatedLabel: "Yesterday",
    updatedOrder: 90
  },
  {
    id: "current-goals",
    collection: "operating-context",
    path: "current-goals.md",
    title: "Current goals",
    summary: "The outcomes that should guide decisions and prioritisation this quarter.",
    body: "# Current goals\n\n## This quarter\n\n1. Establish Passage as the context and publishing layer for agent work.\n2. Publish one practical lesson about agents every week.\n3. Protect two mornings each week for uninterrupted product work.\n\n## Decision rule\n\nPrefer work that compounds into durable products, useful teaching, or reusable systems.",
    starred: true,
    updatedLabel: "Today, 09:42",
    updatedOrder: 100
  },
  {
    id: "products",
    collection: "operating-context",
    path: "products/README.md",
    title: "Products",
    summary: "A concise map of the products I maintain and what each one is trying to achieve.",
    body: "# Products\n\n## Passage\n\nA stable source of truth for the work people do with agents.\n\n## Blueprint\n\nReusable skills that help agents design, plan, implement, test, and review software changes.\n\n## AI Engineer\n\nA community and teaching programme for engineers building with AI.",
    starred: true,
    updatedLabel: "Monday",
    updatedOrder: 82
  },
  {
    id: "writing-voice",
    collection: "operating-context",
    path: "writing/writing-voice.md",
    title: "Writing voice",
    summary: "Rules and examples that help an agent write clearly in my voice.",
    body: "# Writing voice\n\nWrite like a thoughtful practitioner explaining something useful to a peer.\n\n- Use short, direct sentences.\n- Prefer concrete examples over claims.\n- Remove hype, filler, and throat-clearing.\n- Explain the mechanism, not just the outcome.\n- End with a practical next step when one exists.",
    starred: false,
    updatedLabel: "4 Aug",
    updatedOrder: 65
  },
  {
    id: "agent-working-agreement",
    collection: "operating-context",
    path: "working/agent-agreement.md",
    title: "Agent working agreement",
    summary: "How agents should make decisions, verify work, and report uncertainty.",
    body: "# Agent working agreement\n\n## Default behaviour\n\nRead the relevant collection before acting. Make the smallest complete change. Verify the outcome with evidence.\n\n## Ask before acting when\n\n- A choice changes product scope.\n- Access to sensitive context must expand.\n- An external publication cannot be easily reversed.\n\n## Never\n\nInvent evidence, silently overwrite canonical context, or publish an unapproved revision.",
    starred: false,
    updatedLabel: "1 Aug",
    updatedOrder: 60
  },
  {
    id: "context-layer-draft",
    collection: "content-studio",
    path: "drafts/context-layer-for-agents.md",
    title: "Your agents need a context layer",
    summary: "Article draft explaining why repeated prompting is a source-of-truth problem.",
    body: "# Your agents need a context layer\n\nEvery new agent session begins with the same expensive ritual. You explain who you are, what you are building, and how you want the work done.\n\nThe problem is not model memory. The problem is that your working context has no stable home.\n\nA useful context layer should be:\n\n- easy for you to maintain;\n- structured enough for an agent to navigate;\n- explicit about what is canonical; and\n- safe for agents to read and update.\n\nPassage treats ordinary Markdown as that shared source of truth.",
    starred: true,
    updatedLabel: "Today, 11:18",
    updatedOrder: 99,
    status: "Draft"
  },
  {
    id: "collections-note",
    collection: "content-studio",
    path: "ideas/collections-as-context.md",
    title: "Collections are context boundaries",
    summary: "A short teaching note about scoped retrieval for agents.",
    body: "# Collections are context boundaries\n\nA folder tells you where files live. A context collection tells an agent what a group of files means and how it may use them.\n\nThat boundary improves search relevance, access control, token use, and trust.",
    starred: false,
    updatedLabel: "Today, 08:05",
    updatedOrder: 96,
    status: "In review"
  },
  {
    id: "published-cli",
    collection: "content-studio",
    path: "published/agent-friendly-cli.md",
    title: "Build CLIs that agents can use",
    summary: "Published guide to plain-text defaults, JSON output, and stable commands.",
    body: "# Build CLIs that agents can use\n\nA good agent-facing CLI is predictable before it is clever. Use stable commands, plain text by default, structured output on request, and errors that explain the next action.",
    starred: false,
    updatedLabel: "29 Jul",
    updatedOrder: 52,
    status: "Published"
  },
  {
    id: "product-direction",
    collection: "passage",
    path: "product/direction.md",
    title: "Product direction",
    summary: "Passage as a generic Markdown workspace with an agent-native context layer.",
    body: "# Product direction\n\nPassage is a generic Markdown workspace designed for people and agents.\n\n## The wedge\n\nCollections turn large Markdown libraries into useful retrieval boundaries. People can write any document. Agents can discover the right context, work in allowed collections, and propose changes to canonical pages.\n\n## Product rule\n\nDo not prescribe what users store. Make their Markdown legible, retrievable, and safely editable by agents.",
    starred: true,
    updatedLabel: "Today, 10:31",
    updatedOrder: 98
  },
  {
    id: "navigation-decision",
    collection: "passage",
    path: "decisions/search-first-navigation.md",
    title: "Search-first navigation",
    summary: "Why persistent navigation should contain destinations rather than hundreds of documents.",
    body: "# Search-first navigation\n\n## Decision\n\nPersistent navigation contains destinations, not every document.\n\nUsers find a document through four paths:\n\n1. Starred for frequently used documents.\n2. Recent for active work.\n3. Collections for known areas.\n4. Search when they remember the content.\n\nA full file browser remains available inside each collection.",
    starred: false,
    updatedLabel: "Today, 10:02",
    updatedOrder: 97
  },
  {
    id: "mcp-research",
    collection: "research",
    path: "agents/model-context-protocol.md",
    title: "Model Context Protocol notes",
    summary: "Notes on MCP resources, tools, authorization, and remote server behaviour.",
    body: "# Model Context Protocol notes\n\nMCP exposes three useful primitives: resources for context, prompts for user-invoked workflows, and tools for agent actions.\n\nFor Passage, collections map naturally to resource entry points while page search and proposed edits can be tools.",
    starred: false,
    updatedLabel: "30 Jul",
    updatedOrder: 54
  }
];

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function StarIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={filled ? styles.starFilled : undefined}>
      <path d="m12 3 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 17.03l-5.5 2.89 1.05-6.12L3.1 9.47l6.15-.9L12 3Z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3.5h7l4 4v13h-11z" />
      <path d="M13.5 3.5v4h4" />
    </svg>
  );
}

export default function ConceptWorkspace() {
  const [view, setView] = useState<View>({ type: "home" });
  const [documents, setDocuments] = useState(initialDocuments);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState("all");
  const searchTrigger = useRef<HTMLElement | null>(null);

  const openSearch = useCallback((scope = "all") => {
    if (!searchOpen) {
      searchTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setSearchScope(scope);
    setSearchQuery("");
    setSearchOpen(true);
  }, [searchOpen]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    window.requestAnimationFrame(() => searchTrigger.current?.focus());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  const openDocument = (id: string) => {
    setView({ type: "document", id });
    setSearchOpen(false);
  };

  const toggleStar = (id: string) => {
    setDocuments((current) => current.map((doc) => (doc.id === id ? { ...doc, starred: !doc.starred } : doc)));
  };

  const title = viewTitle(view, collections, documents);

  return (
    <main className={styles.workspace}>
      <aside className={styles.sidebar} aria-label="Workspace navigation" inert={searchOpen ? true : undefined}>
        <div className={styles.sidebarTop}>
          <Brand href="/concept" ariaLabel="Passage concept home" />
          <span className={styles.prototypeBadge}>Concept</span>
        </div>

        <button className={styles.searchButton} type="button" onClick={() => openSearch()}>
          <SearchIcon />
          <span>Search</span>
          <kbd>⌘ K</kbd>
        </button>

        <nav className={styles.destinations} aria-label="Workspace destinations">
          <NavigationButton active={view.type === "home"} label="Home" onClick={() => setView({ type: "home" })} />
          <NavigationButton
            active={view.type === "starred"}
            label="Starred"
            count={documents.filter((doc) => doc.starred).length}
            onClick={() => setView({ type: "starred" })}
          />
          <NavigationButton active={view.type === "recent"} label="Recent" onClick={() => setView({ type: "recent" })} />
        </nav>

        <div className={styles.collectionNav}>
          <div className={styles.navLabel}>
            <span>Collections</span>
            <button type="button" aria-label="Create collection">+</button>
          </div>
          {collections.map((collection) => (
            <button
              className={styles.collectionNavItem}
              data-active={view.type === "collection" && view.slug === collection.slug}
              type="button"
              key={collection.slug}
              onClick={() => setView({ type: "collection", slug: collection.slug })}
            >
              <span className={styles.collectionDot} style={{ background: collection.accent }} />
              <span>{collection.title}</span>
              <small>{documents.filter((doc) => doc.collection === collection.slug).length}</small>
            </button>
          ))}
        </div>

        <div className={styles.sidebarBottom}>
          <button type="button"><span className={styles.statusDot} />Agents</button>
          <button type="button">Published</button>
          <button type="button">Archive</button>
          <div className={styles.profile}>
            <span className={styles.avatar}>OL</span>
            <span><strong>Owain Lewis</strong><small>Personal workspace</small></span>
          </div>
        </div>
      </aside>

      <section className={styles.content} aria-label={title} inert={searchOpen ? true : undefined}>
        <header className={styles.mobileHeader}>
          <Brand href="/concept" ariaLabel="Passage concept home" />
          <button type="button" onClick={() => openSearch()} aria-label="Search workspace"><SearchIcon /></button>
        </header>
        {view.type === "home" && (
          <HomeView
            collections={collections}
            documents={documents}
            onOpenCollection={(slug) => setView({ type: "collection", slug })}
            onOpenDocument={openDocument}
            onOpenSearch={() => openSearch()}
          />
        )}
        {view.type === "starred" && (
          <DocumentListView
            eyebrow="Your shortcuts"
            title="Starred"
            description="The documents you return to most. Stars are personal and do not change what agents can access."
            documents={documents.filter((doc) => doc.starred)}
            collections={collections}
            onOpenDocument={openDocument}
            onToggleStar={toggleStar}
          />
        )}
        {view.type === "recent" && (
          <DocumentListView
            eyebrow="Pick up where you left off"
            title="Recent"
            description="Documents you opened or edited recently. Agent reads do not appear here."
            documents={[...documents].sort((a, b) => b.updatedOrder - a.updatedOrder).slice(0, 8)}
            collections={collections}
            onOpenDocument={openDocument}
            onToggleStar={toggleStar}
          />
        )}
        {view.type === "collections" && (
          <CollectionsView
            collections={collections}
            documents={documents}
            onOpenCollection={(slug) => setView({ type: "collection", slug })}
          />
        )}
        {view.type === "collection" && (
          <CollectionView
            collection={collections.find((collection) => collection.slug === view.slug)!}
            collections={collections}
            documents={documents.filter((doc) => doc.collection === view.slug)}
            onOpenDocument={openDocument}
            onToggleStar={toggleStar}
            onSearch={() => openSearch(view.slug)}
          />
        )}
        {view.type === "document" && (
          <DocumentView
            document={documents.find((doc) => doc.id === view.id)!}
            collection={collections.find((collection) => collection.slug === documents.find((doc) => doc.id === view.id)!.collection)!}
            onBack={(slug) => setView({ type: "collection", slug })}
            onToggleStar={toggleStar}
          />
        )}
      </section>

      <nav className={styles.mobileNav} aria-label="Mobile workspace navigation" inert={searchOpen ? true : undefined}>
        <NavigationButton active={view.type === "home"} label="Home" onClick={() => setView({ type: "home" })} />
        <NavigationButton active={view.type === "starred"} label="Starred" onClick={() => setView({ type: "starred" })} />
        <button type="button" onClick={() => openSearch()}><SearchIcon /><span>Search</span></button>
        <NavigationButton active={view.type === "recent"} label="Recent" onClick={() => setView({ type: "recent" })} />
        <button type="button" data-active={view.type === "collections" || view.type === "collection"} onClick={() => setView({ type: "collections" })}><span>Collections</span></button>
      </nav>

      {searchOpen && (
        <SearchPalette
          collections={collections}
          documents={documents}
          query={searchQuery}
          scope={searchScope}
          onClose={closeSearch}
          onOpenDocument={openDocument}
          onQueryChange={setSearchQuery}
          onScopeChange={setSearchScope}
        />
      )}
    </main>
  );
}

function NavigationButton({ active, count, label, onClick }: { active: boolean; count?: number; label: string; onClick: () => void }) {
  return (
    <button className={styles.navButton} data-active={active} type="button" onClick={onClick}>
      <span>{label}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
}

function HomeView({
  collections: allCollections,
  documents,
  onOpenCollection,
  onOpenDocument,
  onOpenSearch
}: {
  collections: Collection[];
  documents: WorkspaceDocument[];
  onOpenCollection: (slug: string) => void;
  onOpenDocument: (id: string) => void;
  onOpenSearch: () => void;
}) {
  const starred = documents.filter((doc) => doc.starred).slice(0, 4);
  const recent = [...documents].sort((a, b) => b.updatedOrder - a.updatedOrder).slice(0, 4);

  return (
    <div className={styles.pageShell}>
      <header className={styles.homeHero}>
        <p className={styles.eyebrow}>Thursday, 13 August</p>
        <h1>Good afternoon, Owain.</h1>
        <p>Your Markdown, organised for you and legible to every agent you trust.</p>
        <button type="button" className={styles.heroSearch} onClick={onOpenSearch}>
          <SearchIcon />
          <span>Search 376 documents across 8 collections</span>
          <kbd>⌘ K</kbd>
        </button>
      </header>

      <section className={styles.homeSection}>
        <SectionHeading title="Starred" action="View all" />
        <div className={styles.documentGrid}>
          {starred.map((doc) => (
            <DocumentCard key={doc.id} document={doc} collection={allCollections.find((item) => item.slug === doc.collection)!} onOpen={() => onOpenDocument(doc.id)} />
          ))}
        </div>
      </section>

      <section className={styles.homeSection}>
        <SectionHeading title="Collections" action="View all" />
        <div className={styles.collectionGrid}>
          {allCollections.map((collection) => (
            <button className={styles.collectionCard} type="button" key={collection.slug} onClick={() => onOpenCollection(collection.slug)}>
              <span className={styles.collectionMark} style={{ background: collection.accent }} />
              <span className={styles.collectionCardBody}>
                <span className={styles.collectionCardTop}>
                  <strong>{collection.title}</strong>
                  <small>{documents.filter((doc) => doc.collection === collection.slug).length} files</small>
                </span>
                <span>{collection.description}</span>
                <small className={styles.collectionType}>{collection.kind === "context" ? "Source of truth" : "Working collection"}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.homeSection}>
        <SectionHeading title="Recent" action="View all" />
        <div className={styles.compactList}>
          {recent.map((doc) => (
            <DocumentRow key={doc.id} document={doc} collection={allCollections.find((item) => item.slug === doc.collection)!} onOpen={() => onOpenDocument(doc.id)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionHeading({ title, action }: { title: string; action: string }) {
  return <div className={styles.sectionHeading}><h2>{title}</h2><span>{action}</span></div>;
}

function DocumentCard({ document, collection, onOpen }: { document: WorkspaceDocument; collection: Collection; onOpen: () => void }) {
  return (
    <button className={styles.documentCard} type="button" onClick={onOpen}>
      <span className={styles.documentCardMeta}><span style={{ color: collection.accent }}>{collection.title}</span><span>{document.updatedLabel}</span></span>
      <strong>{document.title}</strong>
      <span>{document.summary}</span>
      <span className={styles.documentCardPath}><FileIcon />{document.path}</span>
    </button>
  );
}

function DocumentRow({
  document,
  collection,
  onOpen,
  onToggleStar
}: {
  document: WorkspaceDocument;
  collection: Collection;
  onOpen: () => void;
  onToggleStar?: () => void;
}) {
  return (
    <div className={styles.documentRow}>
      <button type="button" className={styles.rowOpen} onClick={onOpen}>
        <span className={styles.rowIcon}><FileIcon /></span>
        <span className={styles.rowMain}><strong>{document.title}</strong><small>{collection.title} / {document.path}</small></span>
        {document.status && <span className={styles.status}>{document.status}</span>}
        <span className={styles.rowUpdated}>{document.updatedLabel}</span>
      </button>
      {onToggleStar && (
        <button className={styles.starButton} type="button" aria-label={`${document.starred ? "Unstar" : "Star"} ${document.title}`} onClick={onToggleStar}>
          <StarIcon filled={document.starred} />
        </button>
      )}
    </div>
  );
}

function DocumentListView({
  eyebrow,
  title,
  description,
  documents,
  collections: allCollections,
  onOpenDocument,
  onToggleStar
}: {
  eyebrow: string;
  title: string;
  description: string;
  documents: WorkspaceDocument[];
  collections: Collection[];
  onOpenDocument: (id: string) => void;
  onToggleStar: (id: string) => void;
}) {
  return (
    <div className={styles.pageShell}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className={styles.largeList}>
        {documents.map((doc) => (
          <DocumentRow
            key={doc.id}
            document={doc}
            collection={allCollections.find((collection) => collection.slug === doc.collection)!}
            onOpen={() => onOpenDocument(doc.id)}
            onToggleStar={() => onToggleStar(doc.id)}
          />
        ))}
        {documents.length === 0 && <p className={styles.emptyState}>No starred documents yet.</p>}
      </div>
    </div>
  );
}

function CollectionsView({
  collections: allCollections,
  documents,
  onOpenCollection
}: {
  collections: Collection[];
  documents: WorkspaceDocument[];
  onOpenCollection: (slug: string) => void;
}) {
  return (
    <div className={styles.pageShell}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Browse by area</p>
        <h1>Collections</h1>
        <p>Collections group related Markdown and give agents a clear boundary for search, context, and access.</p>
      </header>
      <div className={styles.collectionGrid}>
        {allCollections.map((collection) => (
          <button className={styles.collectionCard} type="button" key={collection.slug} onClick={() => onOpenCollection(collection.slug)}>
            <span className={styles.collectionMark} style={{ background: collection.accent }} />
            <span className={styles.collectionCardBody}>
              <span className={styles.collectionCardTop}>
                <strong>{collection.title}</strong>
                <small>{documents.filter((doc) => doc.collection === collection.slug).length} files</small>
              </span>
              <span>{collection.description}</span>
              <small className={styles.collectionType}>{collection.kind === "context" ? "Source of truth" : "Working collection"}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CollectionView({
  collection,
  collections: allCollections,
  documents,
  onOpenDocument,
  onToggleStar,
  onSearch
}: {
  collection: Collection;
  collections: Collection[];
  documents: WorkspaceDocument[];
  onOpenDocument: (id: string) => void;
  onToggleStar: (id: string) => void;
  onSearch: () => void;
}) {
  const contextCollections = collection.context?.map((slug) => allCollections.find((item) => item.slug === slug)!).filter(Boolean) ?? [];
  return (
    <div className={styles.pageShell}>
      <header className={styles.collectionHeader}>
        <div className={styles.collectionIdentity}>
          <span className={styles.largeCollectionMark} style={{ background: collection.accent }} />
          <div><p className={styles.eyebrow}>{collection.kind === "context" ? "Source of truth" : "Working collection"}</p><h1>{collection.title}</h1></div>
        </div>
        <p>{collection.description}</p>
        <div className={styles.collectionActions}>
          <button className={styles.primaryButton} type="button">New document</button>
          <button className={styles.secondaryButton} type="button" onClick={onSearch}><SearchIcon />Search this collection</button>
          <button className={styles.moreButton} type="button" aria-label="More collection actions">•••</button>
        </div>
      </header>

      <div className={styles.collectionInfoGrid}>
        <section className={styles.agentCard}>
          <span className={styles.agentGlyph}>⌁</span>
          <div><p>Agent access</p><strong>{collection.agentAccess}</strong><small>Every read and change is attributed.</small></div>
          <button type="button">Manage</button>
        </section>
        <section className={styles.contextCard}>
          <p>{collection.kind === "context" ? "Used by" : "Uses context from"}</p>
          {collection.kind === "context" ? (
            <strong>{collection.slug === "operating-context" ? "Content Studio and Research" : "No linked work collections"}</strong>
          ) : contextCollections.map((item) => <strong key={item.slug}><span className={styles.collectionDot} style={{ background: item.accent }} />{item.title}</strong>)}
          <small>Agents discover linked context before they work.</small>
        </section>
      </div>

      <section className={styles.collectionDocuments}>
        <div className={styles.sectionHeading}><h2>Documents</h2><span>{documents.length} files</span></div>
        <div className={styles.largeList}>
          {[...documents].sort((a, b) => Number(b.starred) - Number(a.starred) || b.updatedOrder - a.updatedOrder).map((doc) => (
            <DocumentRow
              key={doc.id}
              document={doc}
              collection={collection}
              onOpen={() => onOpenDocument(doc.id)}
              onToggleStar={() => onToggleStar(doc.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function DocumentView({
  document,
  collection,
  onBack,
  onToggleStar
}: {
  document: WorkspaceDocument;
  collection: Collection;
  onBack: (slug: string) => void;
  onToggleStar: (id: string) => void;
}) {
  return (
    <div className={styles.documentView}>
      <header className={styles.documentToolbar}>
        <nav aria-label="Breadcrumb">
          <button type="button" onClick={() => onBack(collection.slug)}>{collection.title}</button>
          <span>/</span>
          <span>{document.path}</span>
        </nav>
        <div>
          {document.status && <span className={styles.status}>{document.status}</span>}
          <button className={styles.starButton} type="button" aria-label={`${document.starred ? "Unstar" : "Star"} ${document.title}`} onClick={() => onToggleStar(document.id)}><StarIcon filled={document.starred} /></button>
          <button type="button" className={styles.shareButton}>Share</button>
          <button className={styles.moreButton} type="button" aria-label="More document actions">•••</button>
        </div>
      </header>
      <div className={styles.documentCanvas}>
        <div className={styles.documentMeta}>
          <span><span className={styles.collectionDot} style={{ background: collection.accent }} />{collection.title}</span>
          <span>Updated {document.updatedLabel}</span>
          <span>Revision 14</span>
        </div>
        <MarkdownView source={document.body} />
      </div>
      <aside className={styles.documentContext}>
        <p>Agent context</p>
        <strong>{collection.kind === "context" ? "Canonical page" : "Working document"}</strong>
        <span>{collection.agentAccess}</span>
        <button type="button">View activity</button>
      </aside>
    </div>
  );
}

function SearchPalette({
  collections: allCollections,
  documents,
  query,
  scope,
  onClose,
  onOpenDocument,
  onQueryChange,
  onScopeChange
}: {
  collections: Collection[];
  documents: WorkspaceDocument[];
  query: string;
  scope: string;
  onClose: () => void;
  onOpenDocument: (id: string) => void;
  onQueryChange: (query: string) => void;
  onScopeChange: (scope: string) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return documents
      .filter((doc) => scope === "all" || doc.collection === scope)
      .filter((doc) => !normalized || [doc.title, doc.path, doc.summary, doc.body].join(" ").toLowerCase().includes(normalized))
      .sort((a, b) => b.updatedOrder - a.updatedOrder)
      .slice(0, 8);
  }, [documents, query, scope]);

  const scopeName = scope === "all" ? "All collections" : allCollections.find((collection) => collection.slug === scope)?.title;

  useEffect(() => {
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;

    const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={styles.paletteBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialog} className={styles.palette} role="dialog" aria-modal="true" aria-label="Search workspace" onKeyDown={handleDialogKeyDown}>
        <div className={styles.paletteInput}>
          <SearchIcon />
          <input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={`Search ${scopeName?.toLowerCase()}…`} aria-label="Search documents" />
          <kbd>ESC</kbd>
        </div>
        <div className={styles.scopeBar}>
          <button type="button" data-active={scope === "all"} onClick={() => onScopeChange("all")}>All</button>
          {allCollections.map((collection) => <button type="button" data-active={scope === collection.slug} onClick={() => onScopeChange(collection.slug)} key={collection.slug}>{collection.title}</button>)}
        </div>
        <div className={styles.searchResults}>
          <p>{query ? `${results.length} results in ${scopeName}` : `Recently updated in ${scopeName}`}</p>
          {results.map((doc) => {
            const collection = allCollections.find((item) => item.slug === doc.collection)!;
            return (
              <button type="button" key={doc.id} onClick={() => onOpenDocument(doc.id)}>
                <span className={styles.resultIcon}><FileIcon /></span>
                <span><strong>{doc.title}</strong><small>{collection.title} / {doc.path}</small><em>{doc.summary}</em></span>
                {doc.starred && <StarIcon filled />}
              </button>
            );
          })}
          {results.length === 0 && <div className={styles.noResults}><strong>No matching documents</strong><span>Try a broader term or another collection.</span></div>}
        </div>
        <footer className={styles.paletteFooter}><span>Tab to navigate</span><span>↵ Open</span><span>Search covers titles, paths, and full Markdown</span></footer>
      </section>
    </div>
  );
}

function viewTitle(view: View, allCollections: Collection[], documents: WorkspaceDocument[]) {
  if (view.type === "home") return "Workspace home";
  if (view.type === "starred") return "Starred documents";
  if (view.type === "recent") return "Recent documents";
  if (view.type === "collections") return "Collections";
  if (view.type === "collection") return allCollections.find((collection) => collection.slug === view.slug)?.title ?? "Collection";
  return documents.find((doc) => doc.id === view.id)?.title ?? "Document";
}
