/**
 * A tiny original capybara holding a stopwatch. Inline SVG, fixed colours so it
 * prints the same everywhere. Pass a class to size it.
 */
export function capybaraSvg(className = 'capy', label = 'A capybara holding a stopwatch'): string {
  return `<svg class="${className}" viewBox="0 0 80 56" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
  <title>${label}</title>
  <g stroke="#4a3220" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">
    <!-- legs -->
    <rect x="13" y="40" width="7" height="11" rx="3" fill="#8c5e3b"/>
    <rect x="31" y="41" width="7" height="10" rx="3" fill="#8c5e3b"/>
    <!-- body: a big loaf -->
    <path d="M8 36 C6 22 18 16 32 17 C42 18 48 22 50 30 C52 40 44 46 30 46 C18 46 9 44 8 36 Z" fill="#a8774d"/>
    <!-- head: boxy with a blunt snout -->
    <path d="M40 14 C42 8 50 6 58 8 C66 10 71 13 72 19 C73 25 69 28 62 28 L50 28 C44 28 40 24 40 19 Z" fill="#a8774d"/>
    <!-- muzzle -->
    <path d="M62 11 C68 12 72 15 72 20 C72 25 68 28 62 28 C64 23 64 16 62 11 Z" fill="#8c5e3b"/>
    <!-- ear -->
    <ellipse cx="45" cy="9" rx="3.2" ry="2.6" fill="#8c5e3b"/>
  </g>
  <!-- eye, nostril, smile -->
  <circle cx="54" cy="15" r="1.7" fill="#1f1610"/>
  <circle cx="54.6" cy="14.4" r="0.5" fill="#fff"/>
  <ellipse cx="69.5" cy="16.5" rx="1.1" ry="0.8" fill="#1f1610"/>
  <path d="M66 23.5 Q68 24.6 70 23.5" fill="none" stroke="#4a3220" stroke-width="1" stroke-linecap="round"/>
  <!-- arm reaching to the stopwatch -->
  <path d="M42 34 Q48 37 53 38" fill="none" stroke="#4a3220" stroke-width="5.2" stroke-linecap="round"/>
  <path d="M42 34 Q48 37 53 38" fill="none" stroke="#8c5e3b" stroke-width="3" stroke-linecap="round"/>
  <!-- stopwatch -->
  <g stroke="#2b2b2b" stroke-width="1.4" stroke-linecap="round">
    <rect x="58.2" y="28.6" width="3.6" height="3" rx="0.8" fill="#d9534a"/>
    <line x1="64.5" y1="31.5" x2="66.3" y2="29.7"/>
    <circle cx="60" cy="40" r="8" fill="#f6f4ee"/>
    <line x1="60" y1="40" x2="60" y2="35"/>
    <line x1="60" y1="40" x2="63" y2="42"/>
  </g>
  <circle cx="60" cy="40" r="1" fill="#2b2b2b"/>
  <!-- paw over the watch -->
  <ellipse cx="54" cy="38.5" rx="2.6" ry="2.2" fill="#8c5e3b" stroke="#4a3220" stroke-width="1.2"/>
</svg>`;
}
