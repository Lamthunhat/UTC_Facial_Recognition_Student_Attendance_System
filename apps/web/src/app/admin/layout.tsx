import { AreaShell } from "@/components/area-shell";

const NAV = [
  { href: "/admin", label: "Điểm danh toàn trường" },
  { href: "/admin/giang-vien", label: "Giảng viên" },
  { href: "/admin/tiet-hoc", label: "Tiết học" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AreaShell title="Quản trị" nav={NAV}>
      {children}
    </AreaShell>
  );
}
