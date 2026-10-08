const channels = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
const blend = (color, base, weight) => {
  const background = channels(base);
  return `rgb(${channels(color).map((value, index) => Math.round(value * weight + background[index] * (1 - weight))).join(', ')})`;
};

export const areaWash = (color, opacity = .12) => `rgba(${channels(color).join(', ')}, ${opacity})`;

// Resolve the palette to RGB/RGBA so the PDF renderer can use the same colors.
export function areaPalette(color, chartAccent = color) {
  return {
    '--area-accent': color,
    '--area-wash': areaWash(color, .07),
    '--area-icon-wash': areaWash(color, .09),
    '--area-keyline': areaWash(color, .2),
    '--area-ink-light': blend(color, '#133354', .65),
    '--area-ink-dark': blend(color, '#d8ebff', .45),
    '--area-series-light': blend(chartAccent, '#004687', .8),
    '--area-series-dark': blend(chartAccent, '#d8ebff', .55),
  };
}
