export function Equalizer({ active = true, size = 16 }: { active?: boolean; size?: number }) {
  return (
    <span className={`eq ${active ? "on" : ""}`} style={{ height: size }} aria-hidden>
      <i /><i /><i /><i />
    </span>
  );
}
