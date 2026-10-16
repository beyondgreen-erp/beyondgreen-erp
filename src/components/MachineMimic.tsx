'use client'

// A drawn stand-in for the machine on the floor, not a photograph and not a CAD model.
// It is deliberately a side-on view with a little depth to it, because an operator should
// be able to glance at it from across the room and know three things at once: is it
// running, is the stack light red, and is product coming off the end.
//
// Everything here is driven by `status`, so the picture can never disagree with the board.

type Props = {
  status: string
  code: string
  // Shown on the little HMI panel in the drawing. Null means we have no live feed.
  counter?: number | null
  live?: boolean
}

const RUNNING = 'Running'
const DOWN = 'Down'
const MAINT = 'Maintenance'

export default function MachineMimic({ status, code, counter, live = false }: Props) {
  const running = status === RUNNING
  const down = status === DOWN
  const maint = status === MAINT

  // Stack light. Only one lamp is lit at a time, the rest sit dark like the real thing.
  const red = down ? '#E2445C' : '#4A1620'
  const amber = maint ? '#F59E0B' : '#4A3410'
  const green = running ? '#2ABF06' : '#14330A'

  return (
    <div className="w-full">
      <style>{`
        @keyframes mmBelt { to { stroke-dashoffset: -32 } }
        @keyframes mmRoll { to { transform: rotate(360deg) } }
        @keyframes mmPack { from { transform: translateX(0); opacity: 0 }
                            10% { opacity: 1 }
                            90% { opacity: 1 }
                            to { transform: translateX(96px); opacity: 0 } }
        @keyframes mmPulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
        .mm-belt { animation: mmBelt 1.1s linear infinite }
        .mm-roll { animation: mmRoll 3.2s linear infinite; transform-origin: 318px 96px }
        .mm-pack { animation: mmPack 2.4s linear infinite }
        .mm-pack2 { animation-delay: .8s }
        .mm-pack3 { animation-delay: 1.6s }
        .mm-alarm { animation: mmPulse 1s ease-in-out infinite }
        .mm-still .mm-belt, .mm-still .mm-roll, .mm-still .mm-pack { animation-play-state: paused }
        @media (prefers-reduced-motion: reduce) {
          .mm-belt, .mm-roll, .mm-pack { animation: none }
        }
      `}</style>

      <svg viewBox="0 0 720 260" className={running ? '' : 'mm-still'} role="img"
           aria-label={'Diagram of machine ' + code + ', currently ' + status}>
        <defs>
          <linearGradient id="mmBody" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F8FAFC" />
            <stop offset="1" stopColor="#CBD5E1" />
          </linearGradient>
          <linearGradient id="mmTop" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#E2E8F0" />
          </linearGradient>
          <linearGradient id="mmSteel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#94A3B8" />
            <stop offset="1" stopColor="#64748B" />
          </linearGradient>
        </defs>

        {/* floor */}
        <rect x="0" y="228" width="720" height="2" fill="#E2E8F0" />

        {/* main frame, with a top face offset to the right so it reads as a solid box */}
        <polygon points="96,72 640,72 668,52 124,52" fill="url(#mmTop)" stroke="#CBD5E1" />
        <rect x="96" y="72" width="544" height="150" rx="6" fill="url(#mmBody)" stroke="#CBD5E1" />
        <polygon points="640,72 668,52 668,202 640,222" fill="#E2E8F0" stroke="#CBD5E1" />

        {/* legs */}
        <rect x="118" y="222" width="12" height="8" fill="#94A3B8" />
        <rect x="596" y="222" width="12" height="8" fill="#94A3B8" />

        {/* three vibratory bowls on the infeed, where the cutlery is loaded */}
        {[0, 1, 2].map((i) => (
          <g key={i} transform={'translate(' + (134 + i * 54) + ',0)'}>
            <ellipse cx="24" cy="104" rx="24" ry="9" fill="url(#mmSteel)" />
            <path d="M0 104 L6 132 L42 132 L48 104 Z" fill="#CBD5E1" stroke="#94A3B8" />
            <ellipse cx="24" cy="104" rx="15" ry="5" fill="#475569" opacity=".5" />
          </g>
        ))}
        <text x="146" y="152" fontSize="11" fill="#64748B">infeed bowls</text>

        {/* conveyor through the middle */}
        <rect x="300" y="150" width="250" height="10" rx="5" fill="#475569" />
        <line className="mm-belt" x1="304" y1="155" x2="546" y2="155"
              stroke="#CBD5E1" strokeWidth="4" strokeDasharray="10 6" strokeLinecap="round" />

        {/* film roll feeding the wrapper */}
        <circle className="mm-roll" cx="318" cy="96" r="26" fill="#E2E8F0" stroke="#94A3B8" />
        <circle cx="318" cy="96" r="7" fill="#94A3B8" />
        <line className="mm-roll" x1="318" y1="70" x2="318" y2="82" stroke="#64748B" strokeWidth="3" />
        <text x="292" y="140" fontSize="11" fill="#64748B">film</text>

        {/* sealing head */}
        <rect x="396" y="100" width="76" height="44" rx="5" fill="url(#mmSteel)" />
        <rect x="408" y="112" width="52" height="8" rx="3" fill="#334155" />
        <text x="398" y="94" fontSize="11" fill="#64748B">seal / cut</text>

        {/* wrapped packets leaving on the outfeed */}
        <g transform="translate(548,142)">
          {[0, 1, 2].map((i) => (
            <rect key={i} className={'mm-pack' + (i === 1 ? ' mm-pack2' : i === 2 ? ' mm-pack3' : '')}
                  x="0" y="0" width="26" height="12" rx="2"
                  fill={running ? '#2ABF06' : '#CBD5E1'} opacity="0" />
          ))}
        </g>
        <rect x="640" y="152" width="46" height="6" rx="3" fill="#94A3B8" />
        <text x="628" y="176" fontSize="11" fill="#64748B">outfeed</text>

        {/* stack light */}
        <rect x="576" y="12" width="6" height="40" fill="#94A3B8" />
        <circle cx="579" cy="8" r="9" fill={red} className={down ? 'mm-alarm' : ''} />
        <circle cx="579" cy="28" r="9" fill={amber} />
        <circle cx="579" cy="48" r="9" fill={green} />

        {/* HMI panel, showing the live count when we have one */}
        <rect x="196" y="58" width="150" height="56" rx="6" fill="#0F172A" transform="translate(252,0)" />
        <text x="462" y="82" fontSize="10" fill="#64748B" letterSpacing="1">COUNT</text>
        <text x="462" y="104" fontSize="22" fontWeight="700"
              fill={live ? '#2ABF06' : '#475569'} fontFamily="ui-monospace, monospace">
          {live && counter !== null && counter !== undefined ? counter.toLocaleString() : '- - - -'}
        </text>

        {/* machine code on the side of the frame */}
        <text x="116" y="214" fontSize="13" fontWeight="700" fill="#94A3B8" letterSpacing="1">{code}</text>
      </svg>
    </div>
  )
}
