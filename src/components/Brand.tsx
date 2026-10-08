import Link from "next/link";
import Image from "next/image";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/solcrm-logo.jpg"
      width={40}
      height={40}
      sizes="48px"
      alt=""
      aria-hidden="true"
      className={`brand-mark ${className}`}
    />
  );
}

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="SolCRM home">
      <BrandMark />
      <span>
        sol<span className="brand-light">crm</span>
        <span className="brand-period">.</span>
      </span>
    </Link>
  );
}
export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
