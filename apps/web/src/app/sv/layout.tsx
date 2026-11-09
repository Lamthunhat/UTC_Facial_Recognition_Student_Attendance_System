import { AreaShell } from "@/components/area-shell";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <AreaShell
      title="Sinh viên"
      logoutTo="/sv"
      nav={[
        { href: "/sv/lop", label: "Lớp học" },
        { href: "/sv/the-sinh-vien", label: "Thẻ sinh viên" },
      ]}
    >
      <div className="mx-auto max-w-lg">{children}</div>
    </AreaShell>
  );
}
