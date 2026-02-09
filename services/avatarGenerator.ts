/**
 * Procedural SVG Avatar Generator
 * Generates unique, deterministic avatars from character name + persona
 */

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

const hsl = (h: number, s: number, l: number) => `hsl(${h}, ${s}%, ${l}%)`;

export const generateAvatar = (name: string, persona: string = ''): string => {
  const seed = hashString(name + persona);

  const hue1 = seed % 360;
  const hue2 = (seed * 137) % 360;
  const hue3 = (seed * 251) % 360;

  // Detect character traits from persona
  const isFeminine = /女|優|穏|姫|お嬢|母|妻|姉/.test(persona);
  const isSerious = /厳|威|重|堅|冷|知|博/.test(persona);

  // Face skin tone variety
  const skinL = 65 + (seed % 20);

  // Eye size variety
  const eyeR = 3 + (seed % 3);

  // Mouth curvature
  const mouthCurve = isSerious ? 56 : 62;

  // Hair style
  const hairPath = isFeminine
    ? `M20 40 Q25 10 50 8 Q75 10 80 40 L82 58 Q78 48 72 40 L28 40 Q22 48 18 58 Z`
    : `M24 38 Q30 12 50 10 Q70 12 76 38 Q62 28 50 30 Q38 28 24 38 Z`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${hsl(hue1, 50, 22)}"/>
      <stop offset="100%" stop-color="${hsl(hue2, 40, 18)}"/>
    </linearGradient>
    <radialGradient id="face" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="${hsl(hue1, 30, skinL + 5)}"/>
      <stop offset="100%" stop-color="${hsl(hue1, 35, skinL - 5)}"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" rx="20" fill="url(#bg)"/>
  <circle cx="50" cy="48" r="28" fill="url(#face)"/>
  <circle cx="38" cy="44" r="${eyeR}" fill="${hsl(hue3, 50, 25)}"/>
  <circle cx="62" cy="44" r="${eyeR}" fill="${hsl(hue3, 50, 25)}"/>
  <circle cx="${39 + (eyeR > 4 ? 1 : 0)}" cy="${43}" r="1.5" fill="white" opacity="0.9"/>
  <circle cx="${63 + (eyeR > 4 ? 1 : 0)}" cy="${43}" r="1.5" fill="white" opacity="0.9"/>
  <path d="M42 ${mouthCurve} Q50 ${mouthCurve + 6} 58 ${mouthCurve}" fill="none" stroke="${hsl(hue1, 30, skinL - 20)}" stroke-width="1.8" stroke-linecap="round"/>
  <path d="${hairPath}" fill="${hsl(hue2, 45, 25)}"/>
  <text x="50" y="92" text-anchor="middle" font-size="10" fill="${hsl(hue1, 25, 55)}" font-family="sans-serif" font-weight="bold">${name.charAt(0)}</text>
</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};
