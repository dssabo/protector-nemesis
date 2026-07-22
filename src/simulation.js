// Core simulation for the "protector / nemesis" field game.
//
// The rules of the real game: everyone on an open field secretly picks one
// person to be their PROTECTOR and another to be their NEMESIS. The goal is to
// move so that your protector always stays on the straight line between you and
// your nemesis — i.e. your protector "screens" you from your nemesis. Because
// everyone is doing this at once (and the protectors/nemeses are themselves
// moving), the whole crowd churns around endlessly. That churn is the game.
//
// This module is deliberately framework-agnostic — plain JS, no React — so the
// physics is easy to reason about on its own. Units are pixels and seconds.

const TAU = Math.PI * 2

export const AGENT_RADIUS = 9

// Decorative dot colors — they carry NO meaning (protector/nemesis are secret
// and shown only by the sightlines). They exist purely so you can tell
// neighbours apart at a glance. There are only this many, so with a big crowd
// they necessarily repeat; to actually follow one person, click them. Chosen
// bright so they pop against the dark field, and spread across hue AND lightness
// so they stay distinguishable to colour-blind eyes rather than relying on a
// red/green split.
const COLORS = [
  '#74c0fc', // sky blue
  '#ffd43b', // yellow
  '#ff922b', // orange
  '#da77f2', // purple
  '#3bc9db', // cyan
  '#ff8787', // salmon
  '#a9e34b', // lime
  '#f783ac', // pink
  '#63e6be', // teal
  '#ffa94d', // amber
  '#9775fa', // violet
  '#e9ecef', // pale grey
]

function rand(min, max) { return min + Math.random() * (max - min) }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }
function lerp(a, b, t) { return a + (b - a) * t }

// Box–Muller gaussian, used for "misjudging" where people are.
function gauss(sigma) {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v)
}

export class Simulation {
  constructor(width, height) {
    this.width = width
    this.height = height
    this.agents = []
    this.params = {
      count: 20,
      speed: 70,        // px/s — a person's comfortable top speed
      humanFactor: 0.4, // 0 = crisp robot, 1 = laggy, imperfect human
      urgency: 0.65,    // 0 = screening is just one urge among many; 1 = get
                        // screened above all else (overriding the comfort urges)
    }
    this.reset()
  }

  setSize(w, h) { this.width = w; this.height = h }

  // The "human factor" knob drives several human imperfections at once.
  // At 0 everything is instant and exact; at 1 people react late, misjudge
  // positions, can't turn or stop on a dime, wobble, and occasionally stop
  // paying attention (which is how the rare real collisions happen).
  tunables() {
    const hf = clamp(this.params.humanFactor, 0, 1)
    return {
      hf,
      reactionInterval: lerp(0, 0.34, hf),   // s between "glances" at the field
      perceptionNoise: lerp(0, 24, hf * hf), // px error in judging positions
      accelTime: lerp(0.03, 0.7, hf),        // s to reach/shed full speed (inertia)
      turnRate: lerp(40, 2.6, hf),           // rad/s — how fast you can change heading
      jitter: lerp(0, 1.0, hf),              // random wobble in your path
      lapseRate: lerp(0, 0.22, hf),          // per-second chance of a not-looking lapse
      openSpace: lerp(0, 1.0, hf),           // drive to drift into roomy gaps
      edgeCare: lerp(1.4, 3.2, hf),          // how firmly you keep off the field edges
    }
  }

  // (Re)build the crowd, hand out fresh assignments, and stand everyone in an
  // evenly-spaced starting circle.
  reset() {
    const n = clamp(Math.round(this.params.count), 2, 120)
    const agents = []
    for (let i = 0; i < n; i++) {
      agents.push({
        id: i,
        x: 0, y: 0,           // real positions come from formCircle() below
        vx: 0, vy: 0,
        heading: rand(0, TAU),
        color: COLORS[i % COLORS.length],
        protector: 0,
        nemesis: 0,
        lineOverride: null,   // null = follow the global toggle; else a forced bool
        perc: { px: 0, py: 0, nx: 0, ny: 0, timer: 0 }, // delayed/noisy view of P & N
        distract: 0,          // >0 while momentarily not avoiding others
        _nvx: 0, _nvy: 0,
      })
    }
    this.agents = agents
    this.assign()
    this.formCircle()
  }

  // Stand everyone in an evenly-spaced ring in the middle of the field. The
  // ring's size grows with the crowd so people stay decently spaced, but it's
  // capped to fit inside the field. Keeps current protector/nemesis choices.
  formCircle() {
    const n = this.agents.length
    const cx = this.width / 2, cy = this.height / 2
    const spacing = AGENT_RADIUS * 6                 // desired gap between neighbours
    const fit = Math.min(this.width, this.height) / 2 - AGENT_RADIUS - 14
    const radius = n > 1 ? clamp((n * spacing) / TAU, AGENT_RADIUS * 4, fit) : 0
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU
      const a = this.agents[i]
      a.x = cx + Math.cos(ang) * radius
      a.y = cy + Math.sin(ang) * radius
      a.vx = a.vy = 0
      a.distract = 0
      this.refreshPerception(a, 0)
    }
  }

  // Re-scatter everyone at random but keep their current protector/nemesis choices.
  scatter() {
    for (const a of this.agents) {
      a.x = rand(AGENT_RADIUS, this.width - AGENT_RADIUS)
      a.y = rand(AGENT_RADIUS, this.height - AGENT_RADIUS)
      a.vx = a.vy = 0
      a.distract = 0
      this.refreshPerception(a, 0)
    }
  }

  // Hand everyone a new, distinct protector and nemesis.
  assign() {
    const n = this.agents.length
    for (let i = 0; i < n; i++) {
      const a = this.agents[i]
      if (n < 3) { a.protector = (i + 1) % n; a.nemesis = (i + 1) % n; continue }
      let p = i, q = i
      while (p === i) p = (Math.random() * n) | 0
      while (q === i || q === p) q = (Math.random() * n) | 0
      a.protector = p
      a.nemesis = q
    }
    for (const a of this.agents) this.refreshPerception(a, 0)
  }

  setCount(c) {
    this.params.count = clamp(Math.round(c), 2, 120)
    this.reset()
  }

  // Refresh an agent's remembered view of where its protector & nemesis are,
  // optionally with some misjudgement (noise) baked in. This also bakes in
  // ANTICIPATION: rather than a target's current spot we take where it will be
  // a short time from now, projected from its current velocity. Anticipation is
  // a HUMAN skill here — a crisp robot (human factor 0) tracks exact current
  // positions with no lead, while a human reads direction of travel and leads
  // their targets, which is what lets them flow into position and cut smooth
  // arcs instead of forever reacting to where people just were.
  refreshPerception(a, noise) {
    const lead = lerp(0, 0.55, clamp(this.params.humanFactor, 0, 1))
    const p = this.agents[a.protector]
    const n = this.agents[a.nemesis]
    a.perc.px = p.x + p.vx * lead + (noise ? gauss(noise) : 0)
    a.perc.py = p.y + p.vy * lead + (noise ? gauss(noise) : 0)
    a.perc.nx = n.x + n.vx * lead + (noise ? gauss(noise) : 0)
    a.perc.ny = n.y + n.vy * lead + (noise ? gauss(noise) : 0)
  }

  // Whether an agent's sightlines should be drawn, given the global toggle.
  linesVisible(a, globalOn) {
    return a.lineOverride === null ? globalOn : a.lineOverride
  }

  // Advance the whole simulation by dt seconds.
  step(dt) {
    dt = Math.min(dt, 0.05) // don't let a stalled tab teleport everyone
    const t = this.tunables()
    const maxSpeed = this.params.speed
    const maxAccel = maxSpeed / t.accelTime
    const agents = this.agents
    // How hard people pursue a screened spot vs. the comfort urges (spacing,
    // open space). Urgency does two things at once: it boosts the pull toward
    // the line, AND makes the comfort urges yield — so a determined person
    // presses for the line even through a crowd, tolerating less personal space
    // and less roominess, instead of weighing everything equally.
    const urgency = clamp(this.params.urgency, 0, 1)
    const seekGain = lerp(0.8, 2.2, urgency)
    const comfortScale = lerp(1.15, 0.5, urgency)
    // How sharply people cut toward the line. Low urgency = a lazy wide arc at
    // arm's length; high urgency = a big turn that cuts more directly across to
    // get behind the protector right now (accepting a closer, more assertive
    // move). This is the knob that trades the earlier "don't crowd in" arc for
    // decisive pursuit.
    const maxStep = lerp(0.45, 2.2, urgency)

    // --- 1. Perception & attention -----------------------------------------
    for (const a of agents) {
      a.perc.timer -= dt
      if (t.reactionInterval <= 1e-4 || a.perc.timer <= 0) {
        this.refreshPerception(a, t.perceptionNoise)
        a.perc.timer = t.reactionInterval
      }
      if (a.distract > 0) {
        a.distract -= dt
      } else if (t.lapseRate > 0 && Math.random() < t.lapseRate * dt) {
        // A momentary lapse: for a fraction of a second this person stops
        // watching out for others, which is how the occasional real bump happens.
        a.distract = rand(0.3, 0.9)
      }
    }

    // --- 2. Steering -------------------------------------------------------
    const sepRadius = AGENT_RADIUS * 6.0   // "personal space" — hard push-off zone
    const sepWeight = 2.6
    const openRadius = AGENT_RADIUS * 14   // wider "roominess" sensing zone
    const openWeight = 0.9                  // gentle drift toward open ground
    const screenTol = AGENT_RADIUS * 2.4   // sideways slack that still counts as screened
    const margin = 95                      // soft edge starts this far in
    const maxOrbit = Math.min(this.width, this.height) * 0.40 // don't orbit out to the walls

    for (const a of agents) {
      // Seek: the only goal is a clear SIGHTLINE — get the protector onto the
      // line between you and your nemesis. Two human instincts shape HOW:
      //   1. If you're already screened, you're happy — you don't inch closer,
      //      you just hold your ground (at ANY distance).
      //   2. If you're not screened, you don't dive toward your protector; you
      //      keep your distance and ARC AROUND to get behind them.
      // So we never steer inward. We find where the agent stands on the circle
      // around the protector, and aim at a point a little way around that same
      // circle toward the "safe" bearing (behind the protector, away from the
      // nemesis) — a sideways, orbiting move rather than a closing one.
      let sx = 0, sy = 0
      let ux = a.perc.px - a.perc.nx    // "safe" direction: from nemesis toward protector
      let uy = a.perc.py - a.perc.ny
      const ulen = Math.hypot(ux, uy)
      if (ulen > 1e-3) {
        ux /= ulen; uy /= ulen
        const wx = a.x - a.perc.px, wy = a.y - a.perc.py  // agent relative to protector
        const along = wx * ux + wy * uy                    // how far behind the protector
        const perp = Math.abs(wx * uy - wy * ux)           // sideways offset from the safe ray
        // Screened: behind the protector, and lined up closely enough that their
        // body blocks your view. When true, don't seek at all — at any distance.
        const screened = along > AGENT_RADIUS && perp < screenTol
        if (!screened) {
          const rP = Math.hypot(wx, wy) || 1               // your current distance from them
          // Keep roughly your current distance (don't dive in) — but not so far
          // out that you'd orbit into the walls; if you've drifted too far, reel
          // the orbit back toward a comfortable radius.
          const keepR = clamp(rP, AGENT_RADIUS * 2.5, maxOrbit)
          const angA = Math.atan2(wy, wx)                  // your bearing around the protector
          const angT = Math.atan2(uy, ux)                  // the safe bearing to reach
          let dAng = angT - angA
          while (dAng > Math.PI) dAng -= TAU
          while (dAng < -Math.PI) dAng += TAU
          // Aim part-way around the circle toward the safe bearing. How far is
          // set by urgency: a small step is a gentle tangent (wide arc), a big
          // step cuts more directly across toward the line.
          const stepAng = angA + clamp(dAng, -maxStep, maxStep)
          const tx = a.perc.px + Math.cos(stepAng) * keepR
          const ty = a.perc.py + Math.sin(stepAng) * keepR
          const dx = tx - a.x, dy = ty - a.y
          const d = Math.hypot(dx, dy)
          if (d > 1e-3) {
            // Ease in near the target, but scale the whole pull by urgency so a
            // determined person pushes for the line even through a crowd.
            const desiredSpeed = maxSpeed * seekGain * clamp(d / 55, 0, 1)
            sx = dx / d * desiredSpeed
            sy = dy / d * desiredSpeed
          }
        }
      }

      // Two ranges of crowd awareness, both switched off during an attention
      // lapse. SEPARATION is the close-in "get out of my personal space" shove.
      // OPEN-SPACE is a softer, wider pull toward roomier ground — a person
      // keeps half an eye on where the space is so they've got room to move
      // when they suddenly need to. Its strength rises with the human factor.
      let sepx = 0, sepy = 0
      let openx = 0, openy = 0
      if (a.distract <= 0) {
        for (const b of agents) {
          if (b === a) continue
          const dx = a.x - b.x, dy = a.y - b.y
          const d = Math.hypot(dx, dy)
          if (d <= 0) continue
          if (d < sepRadius) {
            const w = (sepRadius - d) / sepRadius
            sepx += dx / d * w
            sepy += dy / d * w
          }
          if (d < openRadius) {
            const w = (openRadius - d) / openRadius
            openx += dx / d * w
            openy += dy / d * w
          }
        }
        sepx *= maxSpeed * sepWeight * comfortScale
        sepy *= maxSpeed * sepWeight * comfortScale
        openx *= maxSpeed * openWeight * t.openSpace * comfortScale
        openy *= maxSpeed * openWeight * t.openSpace * comfortScale
      }

      // Soft field edge — no fence, people just ease back toward the middle.
      // Care about it more as the human factor rises (and generally keep well
      // clear so the crowd works the interior, not the boundary).
      let bx = 0, by = 0
      if (a.x < margin) bx += (margin - a.x) / margin
      if (a.x > this.width - margin) bx -= (a.x - (this.width - margin)) / margin
      if (a.y < margin) by += (margin - a.y) / margin
      if (a.y > this.height - margin) by -= (a.y - (this.height - margin)) / margin
      bx *= maxSpeed * t.edgeCare
      by *= maxSpeed * t.edgeCare

      // Desired velocity = all urges combined, capped at top speed.
      let dvx = sx + sepx + openx + bx
      let dvy = sy + sepy + openy + by
      const dv = Math.hypot(dvx, dvy)
      if (dv > maxSpeed) { dvx = dvx / dv * maxSpeed; dvy = dvy / dv * maxSpeed }

      // Inertia: you can only change your velocity so fast.
      let ax = dvx - a.vx, ay = dvy - a.vy
      const amag = Math.hypot(ax, ay)
      const maxDV = maxAccel * dt
      if (amag > maxDV) { ax = ax / amag * maxDV; ay = ay / amag * maxDV }
      let nvx = a.vx + ax
      let nvy = a.vy + ay

      // Turn-rate limit: you can't pivot instantly either.
      const spd = Math.hypot(nvx, nvy)
      const curSpeed = Math.hypot(a.vx, a.vy)
      if (curSpeed > 1e-3 && spd > 1e-3) {
        const curAng = Math.atan2(a.vy, a.vx)
        const newAng = Math.atan2(nvy, nvx)
        let dAng = newAng - curAng
        while (dAng > Math.PI) dAng -= TAU
        while (dAng < -Math.PI) dAng += TAU
        const maxTurn = t.turnRate * dt
        if (Math.abs(dAng) > maxTurn) {
          const ang = curAng + Math.sign(dAng) * maxTurn
          nvx = Math.cos(ang) * spd
          nvy = Math.sin(ang) * spd
        }
      }

      // Wobble/confusion: a little random veer in the path.
      if (t.jitter > 0 && spd > 1e-3) {
        const j = (Math.random() - 0.5) * t.jitter * dt * 6
        const c = Math.cos(j), s = Math.sin(j)
        const rx = nvx * c - nvy * s
        const ry = nvx * s + nvy * c
        nvx = rx; nvy = ry
      }

      a._nvx = nvx
      a._nvy = nvy
    }

    // --- 3. Integrate ------------------------------------------------------
    for (const a of agents) {
      a.vx = a._nvx
      a.vy = a._nvy
      a.x += a.vx * dt
      a.y += a.vy * dt
      if (Math.hypot(a.vx, a.vy) > 4) a.heading = Math.atan2(a.vy, a.vx)
    }

    // --- 4. Bodies can't overlap (and sometimes bump) ----------------------
    this.resolveCollisions()

    // --- 5. Hard field boundary (safety net behind the soft edge) ----------
    for (const a of agents) {
      a.x = clamp(a.x, AGENT_RADIUS, this.width - AGENT_RADIUS)
      a.y = clamp(a.y, AGENT_RADIUS, this.height - AGENT_RADIUS)
    }
  }

  // Push apart any overlapping bodies so no one ever passes through anyone.
  // When two people are actually closing on each other (which mostly happens
  // after an attention lapse) they get a little jostle out of it.
  resolveCollisions() {
    const R = AGENT_RADIUS * 2
    const agents = this.agents
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < agents.length; i++) {
        for (let j = i + 1; j < agents.length; j++) {
          const a = agents[i], b = agents[j]
          let dx = b.x - a.x, dy = b.y - a.y
          let d = Math.hypot(dx, dy)
          if (d === 0) { dx = rand(-1, 1); dy = rand(-1, 1); d = Math.hypot(dx, dy) }
          if (d < R) {
            const nx = dx / d, ny = dy / d
            const push = (R - d) / 2
            a.x -= nx * push; a.y -= ny * push
            b.x += nx * push; b.y += ny * push
            if (iter === 0) {
              const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
              if (vn < 0) { // they were moving together — bump them apart
                const imp = -vn * 0.6
                a.vx -= nx * imp; a.vy -= ny * imp
                b.vx += nx * imp; b.vy += ny * imp
              }
            }
          }
        }
      }
    }
  }

  // Nearest agent to a point, within a generous click radius. Used for the
  // per-person sightline toggle.
  pick(x, y) {
    let best = null
    let bestD = (AGENT_RADIUS + 8) ** 2
    for (const a of this.agents) {
      const dx = a.x - x, dy = a.y - y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD) { bestD = d2; best = a }
    }
    return best
  }
}
