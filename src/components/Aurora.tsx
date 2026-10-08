/** Decorative light ribbons. CSS handles motion and reduced-motion preferences. */
export function Aurora({ className = "" }: { className?: string }) {
  return (
    <div className={`aurora ${className}`} aria-hidden="true">
      <div />
      <div />
      <div />
    </div>
  );
}
