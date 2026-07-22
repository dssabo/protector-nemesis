# Protector &amp; Nemesis

A little simulation of a summer-camp field game.

Everyone stands on an open field. In secret, each person picks one other person
to be their **protector** and another to be their **nemesis**. When the game
starts, everyone moves *themselves* so that their protector stays on the
straight line between themselves and their nemesis — a living shield.
Because everyone is doing this at once, and every protector and nemesis is also
on the move, the whole crowd churns around endlessly. That churn is the whole
point — and the exercise.

**Live version:** https://dssabo.github.io/protector-nemesis/

## Controls

- **Participants** — how many people are on the field.
- **Speed** — how fast people move.
- **Human factor** — a single knob from *robotic* to *human*. At the low end the
  dots steer perfectly: instant reactions, exact aim, no wasted motion. Turning
  it up adds slower reactions, misjudged positions, momentum, a limited turn
  rate, path wobble, and occasional real collisions — while sharpening the
  things people do well: anticipating where their targets are heading, drifting
  toward open space, and keeping clear of the field edges.
- **Show all sightlines** — draws each person's line to their protector (blue)
  and nemesis (orange). It's a master switch that resets everyone.
- **Click any person** — toggles just that person's sightlines, on top of the
  master switch, so you can follow one individual through the chaos.
- **Pause / Play**, **Scatter** (re-spread everyone at random), **Circle**
  (send everyone back to an evenly-spaced starting ring), **New targets** (hand
  out fresh protector/nemesis assignments).

### A note on the goal

People aren't trying to hug their protector — they only want a clear line of
sight blocked. Any spot behind the protector (at any distance) is equally good,
so people settle into whatever open space keeps them screened rather than piling
up in a scrum. Bodies never pass through each other.

## Running locally

```bash
npm install
npm run dev
```

## Tech

Vite + React, rendered to a `<canvas>`. The simulation itself
(`src/simulation.js`) is plain framework-agnostic JavaScript. Deployed to GitHub
Pages automatically on every push to `main`.
