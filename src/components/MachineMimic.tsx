'use client'

// A drawn view of the cutlery wrapper on the floor, traced from the photographs of
// WRP-SFK. It is drawn in axonometric projection, so every part is a solid with a top
// face, a front face and an end face, rather than a flat elevation. Left to right: the
// long stainless bed on its legs, the angled cutlery magazines feeding down onto it, the
// film reel on its stand, the sealing head, the HMI on its pedestal with the stack light
// beside it, the two-door control cabinet, and the green outfeed belt off the end.
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

// How far back and up a face steps to give the drawing its depth. Everything uses the
// same pair, which is what keeps the parts looking like one object.
const DX = 30
const DY = 18

// Where each cutlery magazine meets the bed.
const FEEDERS = [104, 184, 404, 484]

type BoxProps = { x: number; y: number; w: number; h: number; dx?: number; dy?: number
  front?: string; top?: string; side?: string }

function Box({ x, y, w, h, dx = DX, dy = DY, front = 'url(#mmFront)',
              top = 'url(#mmTop)', side = '#93A3B5' }: BoxProps) {
  return (
    <g stroke="#8A9AAC" strokeWidth="0.8" strokeLinejoin="round">
      <polygon points={`${x},${y} ${x + w},${y} ${x + w + dx},${y - dy} ${x + dx},${y - dy}`} fill={top} />
      <polygon points={`${x + w},${y} ${x + w + dx},${y - dy} ${x + w + dx},${y + h - dy} ${x + w},${y + h}`} fill={side} />
      <rect x={x} y={y} width={w} height={h} fill={front} />
    </g>
  )
}

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
        @keyframes mmBelt { to { stroke-dashoffset: -30 } }
        @keyframes mmRun  { from { transform: translateX(0) } to { transform: translateX(600px) } }
        @keyframes mmPulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
        .mm-reel { animation: mmReel 4s linear infinite; transform-origin: 310px 80px }
        .mm-belt { animation: mmBelt 1s linear infinite }
        .mm-run  { animation: mmRun 4.4s linear infinite }
        .mm-run2 { animation-delay: 1.5s }
        .mm-run3 { animation-delay: 3s }
        .mm-alarm { animation: mmPulse 1s ease-in-out infinite }
        .mm-still .mm-reel, .mm-still .mm-belt, .mm-still .mm-run { animation-play-state: paused }
        .mm-still .mm-run { opacity: 0 }
        @media (prefers-reduced-motion: reduce) { .mm-reel, .mm-belt, .mm-run { animation: none } }
      `}</style>

      <svg viewBox="0 0 1040 330" className={running ? '' : 'mm-still'} role="img"
           aria-label={'View of machine ' + code + ', currently ' + status}>
        <defs>
          <linearGradient id="mmFront" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#E8EDF3" /><stop offset="1" stopColor="#AEBCCB" />
          </linearGradient>
          <linearGradient id="mmTop" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FBFCFE" /><stop offset="1" stopColor="#DCE4EC" />
          </linearGradient>
          <linearGradient id="mmDarkFront" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#A5B3C3" /><stop offset="1" stopColor="#6E7E90" />
          </linearGradient>
          <pattern id="mmHaz" width="26" height="9" patternUnits="userSpaceOnUse" patternTransform="skewX(-30)">
            <rect width="13" height="9" fill="#F2C200" /><rect x="13" width="13" height="9" fill="#283142" />
          </pattern>
          <clipPath id="mmBedTop">
            <polygon points="60,170 660,170 690,152 90,152" />
          </clipPath>
        </defs>

        {/* ground plane, receding up and to the right */}
        <polygon points="10,300 950,300 1000,270 60,270" fill="#EEF2F6" />
        <polygon points="24,292 936,292 974,269 62,269" fill="url(#mmHaz)" opacity=".7" />
        {/* soft shadow the machine casts on it */}
        <polygon points="86,286 900,286 936,264 122,264" fill="#C3CDD8" opacity=".45" />

        {/* ---------- legs under the bed ---------- */}
        {[104, 284, 452, 620].map((x) => (
          <g key={x}>
            <Box x={x} y={206} w={24} h={62} dx={16} dy={10} front="url(#mmDarkFront)" top="#B9C5D1" side="#5E6E80" />
            <Box x={x - 5} y={266} w={34} h={6} dx={16} dy={10} front="#6E7E90" top="#93A3B5" side="#5E6E80" />
          </g>
        ))}

        {/* ---------- the long bed ---------- */}
        <Box x={60} y={170} w={600} h={36} />
        {/* rivet line down the front of the beam */}
        {Array.from({ length: 15 }, (_, i) => (
          <circle key={i} cx={84 + i * 40} cy="190" r="1.7" fill="#8595A8" />
        ))}

        {/* product travelling the bed, sitting on the top face */}
        <g clipPath="url(#mmBedTop)">
          {[0, 1, 2].map((i) => (
            <polygon key={i} className={'mm-run' + (i === 1 ? ' mm-run2' : i === 2 ? ' mm-run3' : '')}
                     points="72,168 96,168 110,160 86,160" fill="#FFFFFF" stroke="#9FB0C0" strokeWidth="0.8" />
          ))}
        </g>

        {/* ---------- cutlery magazines, sloping up and back ---------- */}
        {FEEDERS.map((x) => (
          <g key={x} stroke="#8A9AAC" strokeWidth="0.8" strokeLinejoin="round">
            {/* upper face, stepped back to give the chute width */}
            <polygon points={`${x + 18},${152} ${x + 31},${152} ${x + 78},${62} ${x + 65},${62}`} fill="#EDF1F6" />
            {/* near face */}
            <polygon points={`${x},${162} ${x + 13},${162} ${x + 60},${72} ${x + 47},${72}`} fill="url(#mmFront)" />
            {/* the stack of cutlery lying in it */}
            <line x1={x + 8} y1="156" x2={x + 54} y2="78" stroke="#97A7B8" strokeWidth="3" strokeDasharray="4 3" />
            {/* drive box at the foot */}
            <Box x={x - 14} y={142} w={18} h={18} dx={12} dy={7} front="#59687A" top="#7A8A9C" side="#44515F" />
          </g>
        ))}

        {/* ---------- film reel on its stand ---------- */}
        <Box x={302} y={80} w={10} h={78} dx={14} dy={8} front="url(#mmDarkFront)" top="#B9C5D1" side="#5E6E80" />
        {/* the far rim, so the reel reads as having thickness */}
        <ellipse cx={310 + 13} cy={80 - 8} rx="46" ry="43" fill="#9FAEBE" stroke="#8A9AAC" />
        <g className="mm-reel">
          <ellipse cx="310" cy="80" rx="46" ry="43" fill="#DAE2EA" stroke="#8A9AAC" strokeWidth="1.2" />
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const a = (i * Math.PI) / 3
            return <ellipse key={i} cx={310 + Math.cos(a) * 27} cy={80 + Math.sin(a) * 25} rx="11" ry="10" fill="#F6F9FC" stroke="#B9C5D1" strokeWidth="0.8" />
          })}
          <circle cx="310" cy="80" r="7" fill="#6E7E90" />
        </g>

        {/* ---------- sealing and cutting head ---------- */}
        <Box x={540} y={104} w={100} h={58} front="url(#mmDarkFront)" top="#C3CDD8" side="#5E6E80" />
        <ellipse cx="624" cy="146" rx="15" ry="14" fill="#263040" />
        <circle cx="624" cy="146" r="5" fill="#6E7E90" />
        <text x="540" y="96" fontSize="11" fill="#64748B">seal and cut</text>

        {/* ---------- stack light, three short cylinders on a post ---------- */}
        <Box x={516} y={62} w={8} h={44} dx={10} dy={6} front="url(#mmDarkFront)" top="#B9C5D1" side="#5E6E80" />
        {[{ cy: 20, c: red, a: down }, { cy: 40, c: amber, a: false }, { cy: 60, c: green, a: false }].map((l, i) => (
          <g key={i} className={l.a ? 'mm-alarm' : ''}>
            <rect x="508" y={l.cy - 7} width="26" height="14" fill={l.c} />
            <ellipse cx="534" cy={l.cy} rx="5" ry="7" fill={l.c} />
            <ellipse cx="508" cy={l.cy} rx="5" ry="7" fill={l.c} opacity=".75" />
          </g>
        ))}

        {/* ---------- HMI on its pedestal ---------- */}
        <Box x={700} y={100} w={14} h={78} dx={12} dy={7} front="url(#mmDarkFront)" top="#B9C5D1" side="#5E6E80" />
        <Box x={658} y={34} w={112} h={70} />
        <polygon points="664,34 764,34 778,24 678,24" fill="#F08C1E" stroke="#C06E12" strokeWidth="0.8" />
        <text x="690" y="32" fontSize="7" fill="#FFF3E0" letterSpacing="1.4">SUNRISE</text>
        <rect x="668" y="44" width="92" height="40" rx="3" fill="#0F172A" />
        <rect x="676" y="88" width="18" height="10" rx="2" fill="#2A3444" />
        <rect x="702" y="88" width="18" height="10" rx="2" fill="#2A3444" />

        {/* ---------- control cabinet ---------- */}
        <Box x={700} y={178} w={165} h={92} />
        <line x1="782" y1="182" x2="782" y2="266" stroke="#8A9AAC" />
        <rect x="772" y="214" width="5" height="18" rx="2" fill="#6E7E90" />
        <rect x="788" y="214" width="5" height="18" rx="2" fill="#6E7E90" />
        <rect x="712" y="192" width="28" height="24" rx="2" fill="#CBD5E1" stroke="#9FB0C0" />
        {/* our own asset label on the right-hand door */}
        <rect x="796" y="200" width="60" height="28" rx="2" fill="#FFFFFF" stroke="#C7D2DD" />
        <text x="826" y="212" fontSize="6.5" fill="#64748B" textAnchor="middle">Cutlery Wrapper</text>
        <text x="826" y="223" fontSize="8" fontWeight="700" fill="#1A1D2E" textAnchor="middle">{code}</text>
        {/* E stop and run lamp on the top face */}
        <ellipse cx="730" cy="172" rx="6" ry="4" fill="#E2445C" />
        <ellipse cx="750" cy="170" rx="5" ry="3.5" fill={running ? '#2ABF06' : '#9FB0C0'} />

        {/* ---------- green outfeed belt, seen from above ---------- */}
        <Box x={880} y={196} w={100} h={12} front="url(#mmFront)" top="#2F7D4F" side="#8A9AAC" />
        <line className="mm-belt" x1="898" y1="187" x2="1002" y2="187"
              stroke="#8FD6AA" strokeWidth="3" strokeDasharray="10 5" strokeLinecap="round" />
        <Box x={892} y={208} w={8} h={60} dx={10} dy={6} front="url(#mmDarkFront)" top="#B9C5D1" side="#5E6E80" />
        <Box x={958} y={208} w={8} h={60} dx={10} dy={6} front="url(#mmDarkFront)" top="#B9C5D1" side="#5E6E80" />
        <text x="935" y="248" fontSize="11" fill="#64748B" textAnchor="middle">outfeed</text>

        {/* ---------- live count, kept clear of the machine ---------- */}
        <rect x="60" y="10" width="182" height="50" rx="6" fill="#0F172A" />
        <text x="76" y="30" fontSize="9" fill="#64748B" letterSpacing="1.5">LIVE COUNT</text>
        <text x="76" y="50" fontSize="19" fontWeight="700"
              fill={live ? '#2ABF06' : '#475569'} fontFamily="ui-monospace, monospace">
          {live && counter !== null && counter !== undefined ? counter.toLocaleString() : '- - - -'}
        </text>
      </svg>
    </div>
  )
}
