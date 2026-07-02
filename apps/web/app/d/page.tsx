import Link from "next/link";

export default function SharedDocument() {
  return (
    <div className="shareView">
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
