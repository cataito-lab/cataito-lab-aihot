const RINGS = ["inset-0", "inset-[17%]", "inset-[34%]"];

function Blip({
  top,
  left,
  delay,
}: {
  top: string;
  left: string;
  delay: string;
}) {
  return (
    <span className="absolute" style={{ top, left }} aria-hidden>
      <span
        className="blip-ring absolute -inset-1 rounded-full border border-neon"
        style={{ animationDelay: delay }}
      />
      <span className="block w-1.5 h-1.5 rounded-full bg-neon shadow-[0_0_10px_var(--neon)]" />
    </span>
  );
}

export function RadarDisc({ size = 200 }: { size?: number }) {
  return (
    <div
      role="img"
      aria-label="雷达扫描动画"
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      {RINGS.map((ring) => (
        <div key={ring} aria-hidden className={`absolute ${ring} rounded-full border border-line`} />
      ))}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at center, color-mix(in srgb, var(--neon) 7%, transparent), transparent 65%)",
        }}
      />
      <div aria-hidden className="absolute left-1/2 top-0 bottom-0 w-px bg-line/60" />
      <div aria-hidden className="absolute top-1/2 left-0 right-0 h-px bg-line/60" />

      <div aria-hidden className="absolute inset-0 rounded-full overflow-hidden">
        <div
          className="radar-sweep absolute -inset-[15%]"
          style={{
            background:
              "conic-gradient(from 0deg, color-mix(in srgb, var(--neon) 30%, transparent), transparent 80deg)",
            borderRadius: "50%",
          }}
        />
      </div>

      <Blip top="26%" left="60%" delay="0s" />
      <Blip top="56%" left="28%" delay="1.1s" />
      <Blip top="40%" left="76%" delay="2s" />

      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-neon neon-glow"
      />
    </div>
  );
}
