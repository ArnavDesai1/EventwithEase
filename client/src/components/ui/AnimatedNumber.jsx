import { useEffect, useRef, useState } from "react";

export default function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    const target = Number(value) || 0;
    const start = prev.current;
    prev.current = target;
    if (start === target) return;

    const diff = target - start;
    const duration = 700;
    const startTime = performance.now();

    function step(now) {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(start + diff * ease));
      if (t < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }, [value]);

  return <>{display}</>;
}
