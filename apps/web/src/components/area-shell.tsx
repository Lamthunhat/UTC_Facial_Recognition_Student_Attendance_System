import Link from "next/link";
import { LogoutButton } from "./logout-button";

export function AreaShell({
  title,
  nav,
  children,
}: {
  title: string;
  nav: { href: string; label: string }[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/" className="font-semibold">
            Điểm danh UTC <span className="text-muted-foreground">· {title}</span>
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1 text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 hover:bg-muted">
                {n.label}
              </Link>
            ))}
          </nav>
          <LogoutButton to="/login" />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
