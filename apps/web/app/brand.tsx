import Link from "next/link";

// The Passage wordmark. Renders as a plain span by default, or as a link to
// `href` when one is given (the editor and share views link it home).
export function Brand({ href, ariaLabel }: { href?: string; ariaLabel?: string }) {
  const inner = <span className="brandName">Passage</span>;

  if (href) {
    return (
      <Link className="brand" href={href} aria-label={ariaLabel ?? "passage.md home"}>
        {inner}
      </Link>
    );
  }

  return <span className="brand">{inner}</span>;
}
