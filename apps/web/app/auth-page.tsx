import Link from "next/link";
import { Brand } from "./brand";
import paper from "./paper.module.css";

// The frame the sign-in pages share: the writer's paper and bar, with the
// wordmark home and one quiet link out.
export function AuthPage({
  link,
  children
}: {
  link: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <main className={paper.paper}>
      <header className={paper.bar}>
        <Brand href="/" />
        <Link className={paper.barLink} href={link.href}>
          {link.label}
        </Link>
      </header>
      {children}
    </main>
  );
}
