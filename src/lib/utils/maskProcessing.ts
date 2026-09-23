/** Same square dilation and edge-replicated Gaussian as MooshieInpaintPrepare. */
export function processMaskCoverage(input: Float32Array, width: number, height: number, grow: number, blur: number, invert: boolean): Float32Array {
  let values = Float32Array.from(input, value => invert ? 1 - value : value);
  const radius = Math.max(0, Math.min(256, Math.round(grow)));
  if (radius) {
    for (const horizontal of [true, false]) {
      const output = new Float32Array(values.length);
      const length = horizontal ? width : height;
      const lines = horizontal ? height : width;
      const queue = new Int32Array(length);
      for (let line = 0; line < lines; line++) {
        const index = (position: number) => horizontal ? line * width + position : position * width + line;
        let head = 0, tail = 0, next = 0;
        for (let position = 0; position < length; position++) {
          const end = Math.min(length - 1, position + radius);
          while (next <= end) {
            while (tail > head && values[index(queue[tail - 1])] <= values[index(next)]) tail--;
            queue[tail++] = next++;
          }
          while (head < tail && queue[head] < position - radius) head++;
          output[index(position)] = values[index(queue[head])];
        }
      }
      values = output;
    }
  }
  const sigma = Math.max(0, Math.min(64, blur));
  if (sigma) {
    const extent = Math.max(1, Math.floor(3 * sigma));
    const kernel = Array.from({ length: extent * 2 + 1 }, (_, i) => Math.exp(-((i - extent) ** 2) / (2 * sigma * sigma)));
    const total = kernel.reduce((sum, value) => sum + value, 0);
    for (const horizontal of [true, false]) {
      const output = new Float32Array(values.length);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let value = 0;
        for (let k = -extent; k <= extent; k++) {
          const sx = horizontal ? Math.max(0, Math.min(width - 1, x + k)) : x;
          const sy = horizontal ? y : Math.max(0, Math.min(height - 1, y + k));
          value += values[sy * width + sx] * kernel[k + extent];
        }
        output[y * width + x] = value / total;
      }
      values = output;
    }
  }
  return values;
}
