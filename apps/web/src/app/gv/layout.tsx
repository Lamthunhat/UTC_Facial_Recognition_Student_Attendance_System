import { AreaShell } from "@/components/area-shell";

export default function InstructorLayout({ children }: { children: React.ReactNode }) {
  return (
    <AreaShell title="Giảng viên" nav={[{ href: "/gv/lop", label: "Lớp của tôi" }]}>
      {children}
    </AreaShell>
  );
}
