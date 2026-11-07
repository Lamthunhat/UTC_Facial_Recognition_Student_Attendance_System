import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Điểm danh UTC</h1>
        <p className="mt-1 text-muted-foreground">
          Điểm danh bằng nhận diện khuôn mặt và vị trí — Trường Đại học Giao thông Vận tải
        </p>
      </div>
      <nav className="flex flex-col gap-3">
        <Link
          href="/sv"
          className="rounded-lg bg-primary px-4 py-3 text-center font-semibold text-primary-foreground"
        >
          Sinh viên đăng nhập
        </Link>
        <Link href="/login" className="rounded-lg border border-border px-4 py-3 text-center">
          Giảng viên / Quản trị
        </Link>
      </nav>
    </main>
  );
}
