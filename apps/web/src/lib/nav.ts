/** Mục menu đang chọn: trùng đường dẫn hoặc là trang con của nó (so theo đoạn "/", không theo tiền tố chuỗi). */
export function isActiveNav(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
