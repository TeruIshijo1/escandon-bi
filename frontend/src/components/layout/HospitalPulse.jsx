import { useId } from 'react';

// One 240px cycle. The animation travels exactly one cycle for a seamless loop.
const PULSE_PATH = 'M0 34 H35 C43 34 44 29 50 29 S57 34 65 34 H83 L90 37 L97 10 L104 46 L111 34 H131 C140 34 143 25 151 25 S165 34 175 34 H240';

export default function HospitalPulse() {
  const id = useId().replace(/:/g, '');
  const patternId = `hospital-pulse-${id}`;

  return (
    <div className="hospital-navbar__pulse" aria-hidden="true">
      <svg className="hospital-navbar__pulse-track" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <defs>
          <pattern id={patternId} width="240" height="58" patternUnits="userSpaceOnUse">
            <path className="hospital-navbar__pulse-halo" d={PULSE_PATH} />
            <path className="hospital-navbar__pulse-line" d={PULSE_PATH} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
