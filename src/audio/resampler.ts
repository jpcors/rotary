/**
 * Pure TypeScript resampler using linear interpolation.
 * All audio is signed 16-bit little-endian PCM.
 */

/**
 * Resample a buffer of 16-bit LE PCM from one sample rate to another.
 */
export function resample(
  input: Buffer,
  fromRate: number,
  toRate: number
): Buffer {
  if (fromRate === toRate) return input;

  const inputSamples = input.length / 2;
  const ratio = toRate / fromRate;
  const outputSamples = Math.floor(inputSamples * ratio);
  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i / ratio;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;

    const s0 = input.readInt16LE(Math.min(srcIdx, inputSamples - 1) * 2);
    const s1 = input.readInt16LE(Math.min(srcIdx + 1, inputSamples - 1) * 2);

    const interpolated = Math.round(s0 + frac * (s1 - s0));
    const clamped = Math.max(-32768, Math.min(32767, interpolated));
    output.writeInt16LE(clamped, i * 2);
  }

  return output;
}

/** 8kHz → 16kHz for Gemini input */
export function upsample8to16(input: Buffer): Buffer {
  return resample(input, 8000, 16000);
}

/** 24kHz → 8kHz for Asterisk playback */
export function downsample24to8(input: Buffer): Buffer {
  return resample(input, 24000, 8000);
}
