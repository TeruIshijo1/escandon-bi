export function formatHonorariosPdfText(value) {
  return String(value ?? '').replace(/[ \t]*[·•][ \t]*/g, ' ');
}
