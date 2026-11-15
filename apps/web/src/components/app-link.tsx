"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, type ComponentProps } from "react";
import { crossesCspBoundary } from "@/lib/csp-navigation";

/**
 * Link / điều hướng tôn trọng CSP theo route: băng qua ranh giới route nhận diện mặt ('wasm-unsafe-eval') → tải document
 * mới (thẻ <a>, location.assign/replace); còn lại → điều hướng phía client của Next như bình thường.
 */
export function AppLink({ href, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const pathname = usePathname();
  if (crossesCspBoundary(pathname, href)) {
    const { prefetch: _p, replace: _r, scroll: _s, ...anchor } = rest;
    void [_p, _r, _s];
    return <a href={href} {...anchor} />;
  }
  return <Link href={href} {...rest} />;
}

export function useAppNavigate() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (href: string, opts: { replace?: boolean } = {}) => {
      if (crossesCspBoundary(pathname, href)) {
        if (opts.replace) window.location.replace(href);
        else window.location.assign(href);
      } else if (opts.replace) router.replace(href);
      else router.push(href);
    },
    [router, pathname],
  );
}
