import Link from "next/link";
import { Brand } from "../brand";

export default function SharedDocument() {
  return (
    <div className="shareView">
      <header className="shareBar">
        <Brand href="/" ariaLabel="passage.md" />
        <span className="shareMeta">Read-only</span>
      </header>

      <main className="shareScroll">
        <div className="shareEmpty">
          <p>Shared documents now use saved Passage links.</p>
          <Link className="shareEmptyLink" href="/login?next=/write">
            Sign in
          </Link>
        </div>
      </main>
    </div>
  );
}
