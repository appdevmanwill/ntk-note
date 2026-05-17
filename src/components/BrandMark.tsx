export default function BrandMark({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <img
      src="/ntk-icon.svg"
      alt=""
      aria-hidden="true"
      className={`${className} rounded-lg shadow-lg`}
    />
  );
}
