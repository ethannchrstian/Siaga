import { useEffect, useRef } from "react";

/** A drifting node graph behind the sign-in card.
 *
 *  Nodes move slowly and a line is drawn between any two that come within
 *  reach, fading with distance. Few elements, low speed, no direction to
 *  follow: the screen is never static and never asks to be watched, which is
 *  the whole requirement for something sitting behind a password field.
 *
 *  It is also the one shape this product has a claim to. The GNN in
 *  ml/train_deep.py runs over a subdistrict adjacency graph of 318 nodes and
 *  874 edges built from polygon borders, so a network of connected places is
 *  what SIAGA actually reasons over, not decoration borrowed from a template.
 */
interface Props {
  /** Successful authentication turns the quiet network into one brief signal. */
  verified?: boolean;
}

export default function Constellation({ verified = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Node count scales with area so a wide monitor does not look sparse and a
    // laptop does not turn into a solid mesh.
    const DENSITY = 1 / 15000;
    const MAX_NODES = 130;
    const LINK = 150;
    const SPEED = verified ? 0.34 : 0.16;

    let w = 0;
    let h = 0;
    let raf = 0;

    type N = { x: number; y: number; vx: number; vy: number; r: number; depth: number; phase: number };
    let nodes: N[] = [];
    const startedAt = performance.now();

    function build() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas!.clientWidth;
      h = canvas!.clientHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const n = Math.min(MAX_NODES, Math.round(w * h * DENSITY));
      nodes = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
        r: 1 + Math.random() * 1.4,
        depth: 0.45 + Math.random() * 0.55,
        phase: Math.random(),
      }));
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      const time = (performance.now() - startedAt) / 1000;
      const cx = w * 0.5;
      const cy = h * 0.5;

      // A slow operational scan gives the graph a centre of gravity without
      // turning it into a decorative particle field. Authentication compresses
      // the cadence into one visible verification wave.
      const scanCycle = verified ? Math.min(time / 1.15, 1) : (time % 6) / 6;
      const scanRadius = scanCycle * Math.hypot(w, h) * 0.62;
      ctx!.beginPath();
      ctx!.arc(cx, cy, scanRadius, 0, Math.PI * 2);
      ctx!.strokeStyle = `rgba(93, 176, 222, ${verified ? 0.3 * (1 - scanCycle) : 0.08 * (1 - scanCycle)})`;
      ctx!.lineWidth = verified ? 1.6 : 1;
      ctx!.stroke();

      // Two incomplete arcs evoke the north-coast operating corridor. They
      // move at different speeds, so the composition has depth but no spinner.
      for (let ring = 0; ring < 2; ring++) {
        const radius = Math.min(w, h) * (0.31 + ring * 0.14);
        const turn = time * (ring ? -0.025 : 0.035);
        ctx!.beginPath();
        ctx!.arc(cx, cy, radius, Math.PI * (1.08 + turn), Math.PI * (1.82 + turn));
        ctx!.strokeStyle = `rgba(93, 137, 190, ${verified ? 0.18 : 0.07})`;
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }

      // Edges first so the nodes sit on top of their own connections.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.hypot(dx, dy);
          if (d > LINK) continue;
          const strength = 1 - d / LINK;
          const edgeAlpha = (verified ? 0.35 : 0.16) * strength * Math.min(nodes[i].depth, nodes[j].depth);
          ctx!.strokeStyle = `rgba(125, 190, 235, ${edgeAlpha})`;
          ctx!.lineWidth = verified ? 1.15 : 1;
          ctx!.beginPath();
          ctx!.moveTo(nodes[i].x, nodes[i].y);
          ctx!.lineTo(nodes[j].x, nodes[j].y);
          ctx!.stroke();

          // Sparse packets make information flow legible. Only a subset of
          // links carries one, keeping the background calm around the form.
          if ((i * 7 + j) % 19 === 0 && strength > 0.28) {
            const progress = (time * (verified ? 0.72 : 0.22) + nodes[i].phase) % 1;
            const px = nodes[i].x + (nodes[j].x - nodes[i].x) * progress;
            const py = nodes[i].y + (nodes[j].y - nodes[i].y) * progress;
            ctx!.fillStyle = `rgba(174, 225, 252, ${verified ? 0.82 : 0.34})`;
            ctx!.beginPath();
            ctx!.arc(px, py, verified ? 1.8 : 1.15, 0, Math.PI * 2);
            ctx!.fill();
          }
        }
      }

      for (const p of nodes) {
        const pulse = 0.72 + Math.sin(time * 1.4 + p.phase * Math.PI * 2) * 0.18;
        if (verified && p.depth > 0.78) {
          ctx!.fillStyle = `rgba(91, 182, 226, ${0.08 * pulse})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.r * 5.5, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.fillStyle = `rgba(164, 211, 246, ${(verified ? 0.78 : 0.42) * p.depth * pulse})`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r * (verified ? 1.18 : 1), 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function step() {
      for (const p of nodes) {
        if (verified) {
          // The network acknowledges the successful login by gently resolving
          // toward the console, not by exploding into confetti.
          p.vx += (w * 0.5 - p.x) * 0.000012;
          p.vy += (h * 0.5 - p.y) * 0.000012;
        }
        p.x += p.vx;
        p.y += p.vy;
        // Bounce rather than wrap: a node crossing an edge and reappearing on
        // the far side drags its links across the whole screen, which is the
        // one movement here loud enough to catch the eye.
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }
    }

    function loop() {
      step();
      draw();
      raf = requestAnimationFrame(loop);
    }

    build();
    if (reduced) {
      draw();
    } else {
      raf = requestAnimationFrame(loop);
    }

    const onResize = () => {
      cancelAnimationFrame(raf);
      build();
      if (reduced) draw();
      else raf = requestAnimationFrame(loop);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [verified]);

  return <canvas className="constellation" ref={ref} aria-hidden="true" />;
}
