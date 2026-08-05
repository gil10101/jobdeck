// 2-wide by 3-tall grid of tiny boxes pulsing on offset cycles — the delays
// and durations are mutually prime-ish, so the pattern never visibly repeats
// and reads as "thinking" rather than a spinner.
const CELLS = [
  { delay: 0, duration: 900 },
  { delay: 430, duration: 1130 },
  { delay: 170, duration: 1010 },
  { delay: 640, duration: 870 },
  { delay: 300, duration: 1210 },
  { delay: 530, duration: 950 }
]

export default function ThinkingDots({ className = '' }: { className?: string }): JSX.Element {
  return (
    <span className={`inline-grid grid-cols-2 gap-[2.5px] align-middle ${className}`} aria-label="agent working">
      {CELLS.map((c, i) => (
        <span
          key={i}
          className="dot-pulse h-[4.5px] w-[4.5px] rounded-[1px] bg-cyan-400"
          style={{ animationDelay: `${c.delay}ms`, animationDuration: `${c.duration}ms` }}
        />
      ))}
    </span>
  )
}
