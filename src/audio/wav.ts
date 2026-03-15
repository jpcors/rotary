/**
 * Create a WAV file header for 16-bit signed linear PCM.
 */
export function createWavHeader(
  dataLength: number,
  sampleRate: number,
  channels: number = 1,
  bitsPerSample: number = 16
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);

  // fmt sub-chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // sub-chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

/**
 * Create a complete WAV buffer from raw PCM data.
 */
export function createWav(
  pcmData: Buffer,
  sampleRate: number
): Buffer {
  const header = createWavHeader(pcmData.length, sampleRate);
  return Buffer.concat([header, pcmData]);
}
