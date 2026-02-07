/**
 * Decodes base64 string to a Uint8Array.
 */
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes Uint8Array to base64 string.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert Float32Array (Web Audio API default) to PCM 16-bit integers
 * and return the appropriate blob/structure for Gemini API.
 */
export function float32ToPCM16(float32: Float32Array): { data: string; mimeType: string } {
  const l = float32.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Clamp values between -1 and 1
    const s = Math.max(-1, Math.min(1, float32[i]));
    // Convert to 16-bit PCM
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  return {
    data: encodeBase64(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

/**
 * Decodes raw PCM 16-bit audio data into an AudioBuffer.
 */
export async function pcm16ToAudioBuffer(
  rawData: Uint8Array,
  audioContext: AudioContext,
  sampleRate: number = 24000
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(rawData.buffer);
  const numChannels = 1;
  const frameCount = dataInt16.length;
  
  const buffer = audioContext.createBuffer(numChannels, frameCount, sampleRate);
  const channelData = buffer.getChannelData(0);
  
  for (let i = 0; i < frameCount; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  
  return buffer;
}