'use client'

// A drawn side elevation of the cutlery wrapper on the floor, traced from the photographs
// of WRP-SFK rather than from a generic idea of what a wrapper looks like. Left to right:
// the long stainless bed on its trapezoid legs, the angled cutlery magazines feeding down
// onto it, the spoked film reel on its stand, the sealing head, the HMI on its pedestal
// with the stack light beside it, the two-door control cabinet, and the green outfeed belt
// running off the end.
//
// It exists so somebody can glance at a screen across the room and know three things at
// once: is it running, is the stack light red, and is product coming off the end.

type Props = {
  status: string
  code: string
  counter?: number | null
  live?: boolean
}

const RUNNING = 'Running'
const DOWN = 'Down'
const MAINT = 'Maintenance'

// The four cutlery magazines, by where they meet the bed.
const FEEDERS = [92, 168, 392, 468]

export default function MachineMimic({ status, code, counter, live = false }: Props) {
  const running = status === RUNNING
  const down = status === DOWN
  const maint = status === MAINT

  // Only one lamp is lit at a time, the same as the real stack light.
  const red = down ? '#E2445C' : '#4A1620'
  const amber = maint ? '#F59E0B' : '#4A3410'
  const green = running ? '#2ABF06' : '#14330A'

  return (
    <div className="w-full">
      <style>{`
        @keyframes mmReel { to { transform: rotate(-360deg) } }
        @keyframes mmBelt { to { stroke-dashoffset: -28 } }
        @keyframes mmRun  { from { transform: translateX(0) }
                            to   { transform: translateX(640px) } }
        @keyframes mmPulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
        .mm-reel { animation: mmReel 4s linear infinite; transform-origin: 288px 74px }
        .mm-belt { animation: mmBelt 1s linear infinite }
        .mm-run  { animation: mmRun 4.2s linear infinite }
        .mm-run2 { animation-delay: 1.4s }
        .mm-run3 { animation-delay: 2.8s }
        .mm-alarm { animation: mmPulse 1s ease-in-out infinite }
        .mm-still .mm-reel, .mm-still .mm-belt, .mm-still .mm-run { animation-play-state: paused }
        .mm-still .mm-run { opacity: 0 }
        @media (prefers-reduced-motion: reduce) {
          .mm-reel, .mm-belt, .mm-run { animation: none }
        }
      `}</style>

      <svg viewBox="0 0 980 300" className={running ? '' : 'mm-still'} role="img"
           aria-label={'Side view of machine ' + code + ', currently ' + status}>
        <defs>
          <linearGradient id="mmSteel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F1F5F9" />
            <stop offset="1" stopColor="#B8C4D2" />
          </linearGradient>
          <linearGradient id="mmDark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#A8B6C6" />
            <stop offset="1" stopColor="#6B7A8C" />
          </linearGradient>
          <pattern id="mmHaz" width="24" height="8" patternUnits="userSpaceOnUse" patternTransform="skewX(-20)">
            <rect width="12" height="8" fill="#F2C200" />
            <rect x="12" width="12" height="8" fill="#1F2937" />
          </pattern>
          <clipPath id="mmBedClip"><rect x="40" y="140" width="640" height="24" /></clipPath>
        </defs>

        {/* floor and the hazard stripe taped round the cell */}
        <rect x="0" y="272" width="980" height="2" fill="#CBD5E1" />
        <rect x="24" y="280" width="930" height="7" fill="url(#mmHaz)" opacity=".75" />

        {/* ---------- the long bed ---------- */}
        {/* trapezoid legs, splayed like the real ones, each on a foot */}
        {[96, 300, 520, 648].map((x) => (
          <g key={x}>
            <polygon points={(x - 16) + ',272 ' + (x + 16) + ',272 ' + (x + 9) + ',200 ' + (x - 9) + ',200'}
                     fill="url(#mmDark)" />
            <rect x={x - 20} y="268" width="40" height="5" rx="2" fill="#64748B" />
          </g>
        ))}
        {/* main box beam */}
        <rect x="40" y="164" width="640" height="38" fill="url(#mmSteel)" stroke="#94A3B8" />
        {/* the running surface on top of it */}
        <rect x="40" y="152" width="640" height="12" fill="#CBD5E1" stroke="#94A3B8" />
        {/* rivet line, which is most of what you see on the real beam */}
        {Array.from({ length: 16 }, (_, i) => (
          <circle key={i} cx={64 + i * 40} cy="184" r="1.6" fill="#8595A8" />
        ))}

        {/* product travelling the length of the bed and off the end */}
        <g clipPath="url(#mmBedClip)">
          {[0, 1, 2].map((i) => (
            <rect key={i} className={'mm-run' + (i === 1 ? ' mm-run2' : i === 2 ? ' mm-run3' : '')}
                  x="40" y="144" width="22" height="9" rx="1.5" fill="#FFFFFF" stroke="#94A3B8" />
          ))}
        </g>

        {/* ---------- cutlery magazines, sloping up and back off the bed ---------- */}
        {FEEDERS.map((x) => (
          <g key={x}>
            <polygon points={x + ',152 ' + (x + 13) + ',152 ' + (x + 60) + ',62 ' + (x + 47) + ',62'}
                     fill="#E2E8F0" stroke="#94A3B8" />
            {/* the stack of cutlery sitting in the chute */}
            <line x1={x + 6} y1="148" x2={x + 53} y2="68" stroke="#94A3B8" strokeWidth="3"
                  strokeDasharray="4 3" />
            {/* drive box at the foot of the chute */}
            <rect x={x - 12} y="138" width="18" height="16" rx="2" fill="#475569" />
          </g>
        ))}

        {/* ---------- spoked film reel on its stand ---------- */}
        <rect x="284" y="74" width="8" height="78" fill="#94A3B8" />
        <g className="mm-reel">
          <circle cx="288" cy="74" r="44" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="2" />
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const a = (i * Math.PI) / 3
            return <circle key={i} cx={288 + Math.cos(a) * 26} cy={74 + Math.sin(a) * 26} r="11" fill="#F8FAFC" />
          })}
          <circle cx="288" cy="74" r="7" fill="#64748B" />
        </g>

        {/* ---------- sealing and cutting head ---------- */}
        <rect x="548" y="98" width="96" height="58" rx="4" fill="url(#mmDark)" stroke="#64748B" />
        <circle cx="630" cy="140" r="15" fill="#1F2937" />
        <circle cx="630" cy="140" r="5" fill="#64748B" />
        <text x="548" y="92" fontSize="11" fill="#64748B">seal and cut</text>

        {/* ---------- stack light ---------- */}
        <rect x="524" y="48" width="7" height="50" fill="#94A3B8" />
        <circle cx="527" cy="16" r="9" fill={red} className={down ? 'mm-alarm' : ''} />
        <circle cx="527" cy="34" r="9" fill={amber} />
        <circle cx="527" cy="52" r="9" fill={green} />

        {/* ---------- HMI on its pedestal ---------- */}
        <rect x="690" y="96" width="12" height="76" fill="#94A3B8" />
        <rect x="658" y="26" width="112" height="74" rx="5" fill="url(#mmSteel)" stroke="#94A3B8" />
        <rect x="664" y="20" width="100" height="10" rx="2" fill="#F08C1E" />
        <text x="672" y="28" fontSize="7" fill="#7C3F00" letterSpacing="1">SUNRISE</text>
        <rect x="668" y="36" width="92" height="42" rx="3" fill="#0F172A" />
        <rect x="676" y="82" width="18" height="11" rx="2" fill="#1F2937" />
        <rect x="702" y="82" width="18" height="11" rx="2" fill="#1F2937" />

        {/* ---------- control cabinet, two doors, on feet ---------- */}
        <rect x="712" y="170" width="170" height="98" rx="4" fill="url(#mmSteel)" stroke="#94A3B8" />
        <line x1="797" y1="174" x2="797" y2="264" stroke="#94A3B8" />
        <rect x="786" y="208" width="5" height="18" rx="2" fill="#64748B" />
        <rect x="803" y="208" width="5" height="18" rx="2" fill="#64748B" />
        <rect x="726" y="186" width="26" height="22" rx="2" fill="#CBD5E1" stroke="#94A3B8" />
        <rect x="724" y="268" width="26" height="5" rx="2" fill="#64748B" />
        <rect x="844" y="268" width="26" height="5" rx="2" fill="#64748B" />
        {/* the beyondGREEN asset label on the right-hand door */}
        <rect x="804" y="196" width="72" height="30" rx="2" fill="#FFFFFF" stroke="#CBD5E1" />
        <text x="840" y="209" fontSize="6.5" fill="#64748B" textAnchor="middle">Cutlery Wrapper</text>
        <text x="840" y="221" fontSize="8" fontWeight="700" fill="#1A1D2E" textAnchor="middle">{code}</text>
        {/* E stop and the run lamp on the front ledge */}
        <circle cx="742" cy="176" r="5" fill="#E2445C" />
        <circle cx="762" cy="176" r="4" fill={running ? '#2ABF06' : '#94A3B8'} />

        {/* ---------- green outfeed belt ---------- */}
        <rect x="884" y="178" width="88" height="16" rx="3" fill="#2F7D4F" />
        <line className="mm-belt" x1="888" y1="186" x2="968" y2="186"
              stroke="#8FD6AA" strokeWidth="3" strokeDasharray="9 5" strokeLinecap="round" />
        <rect x="884" y="194" width="88" height="8" fill="url(#mmSteel)" stroke="#94A3B8" />
        <rect x="896" y="202" width="7" height="66" fill="url(#mmDark)" />
        <rect x="952" y="202" width="7" height="66" fill="url(#mmDark)" />
        <text x="928" y="232" fontSize="11" fill="#64748B" textAnchor="middle">outfeed</text>

        {/* ---------- live count, kept clear of the machine ---------- */}
        <rect x="40" y="8" width="178" height="48" rx="6" fill="#0F172A" />
        <text x="54" y="27" fontSize="9" fill="#64748B" letterSpacing="1.5">LIVE COUNT</text>
        <text x="54" y="47" fontSize="19" fontWeight="700"
              fill={live ? '#2ABF06' : '#475569'} fontFamily="ui-monospace, monospace">
          {live && counter !== null && counter !== undefined ? counter.toLocaleString() : '- - - -'}
        </text>
      </svg>
    </div>
  )
}
