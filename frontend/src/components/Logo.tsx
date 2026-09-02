/** XPR Network glyph from the official brand kit; swaps black/white with the theme. */
export function Logo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <>
      <img src="/xpr-glyph-black.png" alt="" className={`${className} dark:hidden`} />
      <img src="/xpr-glyph-white.png" alt="" className={`${className} hidden dark:block`} />
    </>
  );
}
