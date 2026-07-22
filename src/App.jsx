import { useEffect, useRef, useState, useCallback } from 'react'
import { Simulation, AGENT_RADIUS } from './simulation.js'

export default function App() {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const simRef = useRef(null)
  const rafRef = useRef(0)
  const lastRef = useRef(0)

  // Live controls. These are mirrored into the simulation as they change.
  const [count, setCount] = useState(20)
  const [speed, setSpeed] = useState(70)
  const [humanFactor, setHumanFactor] = useState(40) // shown as a percentage
  const [showLines, setShowLines] = useState(false)
  const [running, setRunning] = useState(true)

  // Keep the latest render-affecting values available to the animation loop
  // without restarting it every time a slider moves.
  const showLinesRef = useRef(showLines)
  const runningRef = useRef(running)
  useEffect(() => { showLinesRef.current = showLines }, [showLines])
  useEffect(() => { runningRef.current = running }, [running])

  // Create the simulation once, sized to its container, and keep it sized to
  // the container as the window changes.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const rect = wrap.getBoundingClientRect()
    const sim = new Simulation(rect.width, rect.height)
    simRef.current = sim

    const resize = () => {
      const r = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
      canvas.style.width = r.width + 'px'
      canvas.style.height = r.height + 'px'
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      sim.setSize(r.width, r.height)
    }
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const loop = (now) => {
      if (!lastRef.current) lastRef.current = now
      const dt = (now - lastRef.current) / 1000
      lastRef.current = now
      if (runningRef.current) sim.step(dt)
      draw(canvas, sim, showLinesRef.current)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [])

  // Push live parameter changes into the running simulation.
  useEffect(() => { if (simRef.current) simRef.current.setCount(count) }, [count])
  useEffect(() => { if (simRef.current) simRef.current.params.speed = speed }, [speed])
  useEffect(() => {
    if (simRef.current) simRef.current.params.humanFactor = humanFactor / 100
  }, [humanFactor])

  // Click / tap a person to flip just their sightlines.
  const onCanvasClick = useCallback((e) => {
    const sim = simRef.current
    if (!sim) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const a = sim.pick(x, y)
    if (a) {
      const current = sim.linesVisible(a, showLinesRef.current)
      a.lineOverride = !current
    }
  }, [])

  // The global toggle is a master switch: it flips everyone and clears any
  // per-person overrides, so you get a clean all-on / all-off baseline that
  // you can then deviate from by clicking individuals.
  const toggleGlobalLines = () => {
    const next = !showLines
    setShowLines(next)
    const sim = simRef.current
    if (sim) for (const a of sim.agents) a.lineOverride = null
  }

  const scatter = () => simRef.current && simRef.current.scatter()
  const reroll = () => simRef.current && simRef.current.assign()

  return (
    <div className="app">
      <aside className="panel">
        <header className="panel-head">
          <h1>Protector <span>&amp;</span> Nemesis</h1>
          <p className="tagline">
            Everyone secretly picks a <b className="prot">protector</b> and a
            {' '}<b className="nem">nemesis</b>, then tries to keep the protector
            {' '}on the line between themselves and their nemesis.
          </p>
        </header>

        <div className="controls">
          <label className="control">
            <div className="control-row">
              <span>Participants</span><span className="val">{count}</span>
            </div>
            <input type="range" min="3" max="80" step="1"
              value={count} onChange={e => setCount(+e.target.value)} />
          </label>

          <label className="control">
            <div className="control-row">
              <span>Speed</span><span className="val">{speed}</span>
            </div>
            <input type="range" min="15" max="200" step="1"
              value={speed} onChange={e => setSpeed(+e.target.value)} />
          </label>

          <label className="control">
            <div className="control-row">
              <span>Human factor</span><span className="val">{humanFactor}%</span>
            </div>
            <input type="range" min="0" max="100" step="1"
              value={humanFactor} onChange={e => setHumanFactor(+e.target.value)} />
            <div className="ends"><span>robotic</span><span>human</span></div>
            <p className="hint">
              Higher = slower reactions, misjudged positions, momentum, wobble,
              and the occasional real collision.
            </p>
          </label>
        </div>

        <div className="buttons">
          <button className={showLines ? 'toggle on' : 'toggle'} onClick={toggleGlobalLines}>
            {showLines ? 'Hide all sightlines' : 'Show all sightlines'}
          </button>
          <div className="button-row">
            <button onClick={() => setRunning(r => !r)}>
              {running ? 'Pause' : 'Play'}
            </button>
            <button onClick={scatter}>Scatter</button>
            <button onClick={reroll}>New targets</button>
          </div>
          <p className="hint tap-hint">Tip: click any person to toggle just their sightlines.</p>
        </div>

        <footer className="panel-foot">
          <span className="key"><i className="dot prot" /> protector</span>
          <span className="key"><i className="dot nem" /> nemesis</span>
        </footer>
      </aside>

      <div className="field" ref={wrapRef}>
        <canvas ref={canvasRef} onClick={onCanvasClick} />
      </div>
    </div>
  )
}

// ---- Rendering -------------------------------------------------------------

function draw(canvas, sim, showLines) {
  const ctx = canvas.getContext('2d')
  const w = sim.width, h = sim.height

  // Field
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#7fb069'
  ctx.fillRect(0, 0, w, h)
  drawGrass(ctx, w, h)

  const agents = sim.agents

  // Sightlines first, so dots sit on top of them.
  for (const a of agents) {
    if (!sim.linesVisible(a, showLines)) continue
    const p = agents[a.protector]
    const n = agents[a.nemesis]
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(20, 90, 40, 0.55)'
    line(ctx, a.x, a.y, p.x, p.y)
    ctx.strokeStyle = 'rgba(150, 20, 30, 0.5)'
    line(ctx, a.x, a.y, n.x, n.y)
  }

  // People
  for (const a of agents) {
    const r = AGENT_RADIUS
    // little "nose" showing which way they're heading
    const hx = Math.cos(a.heading), hy = Math.sin(a.heading)
    ctx.beginPath()
    ctx.moveTo(a.x + hx * (r + 5), a.y + hy * (r + 5))
    ctx.lineTo(a.x - hy * r * 0.7, a.y + hx * r * 0.7)
    ctx.lineTo(a.x + hy * r * 0.7, a.y - hx * r * 0.7)
    ctx.closePath()
    ctx.fillStyle = a.color
    ctx.globalAlpha = 0.55
    ctx.fill()
    ctx.globalAlpha = 1

    // body
    ctx.beginPath()
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2)
    ctx.fillStyle = a.color
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'
    ctx.stroke()

    // ring on anyone whose sightlines are individually shown
    if (sim.linesVisible(a, showLines)) {
      ctx.beginPath()
      ctx.arc(a.x, a.y, r + 4, 0, Math.PI * 2)
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.stroke()
    }
  }
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

// A faint scattering of grass tufts so the "field" reads as a field. Drawn
// deterministically from a fixed pattern so it doesn't flicker frame to frame.
let grassPattern = null
function drawGrass(ctx, w, h) {
  if (!grassPattern || grassPattern.w !== w || grassPattern.h !== h) {
    const pts = []
    // simple deterministic hash so tufts stay put between frames
    let seed = 1234567
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const n = Math.round((w * h) / 5000)
    for (let i = 0; i < n; i++) pts.push([next() * w, next() * h, next()])
    grassPattern = { w, h, pts }
  }
  ctx.strokeStyle = 'rgba(60, 120, 50, 0.35)'
  ctx.lineWidth = 1
  for (const [x, y, r] of grassPattern.pts) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (r - 0.5) * 4, y - 3 - r * 2)
    ctx.stroke()
  }
}
