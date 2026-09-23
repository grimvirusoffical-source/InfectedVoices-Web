// dist/worker/utils.js
function serializeAudioBuffer(audioBuffer) {
  const channelData = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    const buffer = new ArrayBuffer(audioBuffer.length * Float32Array.BYTES_PER_ELEMENT);
    const data = new Float32Array(buffer);
    audioBuffer.copyFromChannel(data, i);
    channelData.push(data);
  }
  return {
    sampleRate: audioBuffer.sampleRate,
    length: audioBuffer.length,
    numberOfChannels: audioBuffer.numberOfChannels,
    channelData
  };
}
function deserializeAudioBuffer(serializable, audioContext) {
  if (audioContext) {
    const audioBuffer = audioContext.createBuffer(serializable.numberOfChannels, serializable.length, serializable.sampleRate);
    for (let i = 0; i < serializable.numberOfChannels; i++) {
      const channelData = serializable.channelData[i];
      const buffer = new ArrayBuffer(channelData.length * Float32Array.BYTES_PER_ELEMENT);
      const typedArray = new Float32Array(buffer);
      typedArray.set(channelData);
      audioBuffer.copyToChannel(typedArray, i);
    }
    return audioBuffer;
  }
  if (typeof OfflineAudioContext !== "undefined") {
    const offlineContext = new OfflineAudioContext(serializable.numberOfChannels, serializable.length, serializable.sampleRate);
    const audioBuffer = offlineContext.createBuffer(serializable.numberOfChannels, serializable.length, serializable.sampleRate);
    for (let i = 0; i < serializable.numberOfChannels; i++) {
      const channelData = serializable.channelData[i];
      const buffer = new ArrayBuffer(channelData.length * Float32Array.BYTES_PER_ELEMENT);
      const typedArray = new Float32Array(buffer);
      typedArray.set(channelData);
      audioBuffer.copyToChannel(typedArray, i);
    }
    return audioBuffer;
  }
  throw new Error("No AudioContext available for deserialization");
}
function getTransferables(serializable) {
  return serializable.channelData.map((channel) => channel.buffer);
}
function downsampleAudioBuffer(audioBuffer, targetSamples = 1e3, channel = 0, useRMS = false) {
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  if (targetSamples >= length) {
    if (channel === -1) {
      const result2 = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sum += audioBuffer.getChannelData(ch)[i];
        }
        result2[i] = sum / numChannels;
      }
      return result2;
    } else {
      return audioBuffer.getChannelData(channel);
    }
  }
  const result = new Float32Array(targetSamples);
  const blockSize = Math.floor(length / targetSamples);
  for (let i = 0; i < targetSamples; i++) {
    const startIdx = i * blockSize;
    const endIdx = Math.min(startIdx + blockSize, length);
    if (useRMS) {
      let sumSquares = 0;
      let count = 0;
      for (let j = startIdx; j < endIdx; j++) {
        if (channel === -1) {
          let sum = 0;
          for (let ch = 0; ch < numChannels; ch++) {
            sum += audioBuffer.getChannelData(ch)[j];
          }
          const avg = sum / numChannels;
          sumSquares += avg * avg;
        } else {
          const sample = audioBuffer.getChannelData(channel)[j];
          sumSquares += sample * sample;
        }
        count++;
      }
      result[i] = count > 0 ? Math.sqrt(sumSquares / count) : 0;
    } else {
      let peak = 0;
      for (let j = startIdx; j < endIdx; j++) {
        if (channel === -1) {
          let sum = 0;
          for (let ch = 0; ch < numChannels; ch++) {
            sum += audioBuffer.getChannelData(ch)[j];
          }
          const avg = Math.abs(sum / numChannels);
          peak = Math.max(peak, avg);
        } else {
          const sample = Math.abs(audioBuffer.getChannelData(channel)[j]);
          peak = Math.max(peak, sample);
        }
      }
      result[i] = peak;
    }
  }
  return result;
}
function validateAudioBuffer(audioBuffer) {
  if (!audioBuffer) {
    throw new Error("AudioBuffer is null or undefined");
  }
  if (audioBuffer.length === 0) {
    throw new Error("AudioBuffer has zero length");
  }
  if (audioBuffer.numberOfChannels === 0) {
    throw new Error("AudioBuffer has zero channels");
  }
  if (audioBuffer.sampleRate <= 0) {
    throw new Error("AudioBuffer has invalid sample rate");
  }
}

// dist/worker/audio-processor.worker.js
var isTerminated = false;
function sendResponse(response, transferables) {
  if (isTerminated)
    return;
  if (transferables && transferables.length > 0) {
    self.postMessage(response, { transfer: transferables });
  } else {
    self.postMessage(response);
  }
}
function sendError(id, error) {
  const message = error instanceof Error ? error.message : error;
  const stack = error instanceof Error ? error.stack : void 0;
  sendResponse({
    type: "error",
    id,
    message,
    stack
  });
}
function sendProgress(id, progress, message) {
  sendResponse({
    type: "progress",
    id,
    progress: Math.max(0, Math.min(1, progress)),
    message
  });
}
async function processAudio(request) {
  const { id } = request;
  sendError(id, new Error("OfflineAudioContext is not available in Web Workers. Audio processing with AudioWorklet must be done in the main thread. Use OfflineProcessor.processWithContext(audioBuffer, audioContext, params) instead."));
  return;
}
async function loadAudio(request) {
  try {
    const { id, url } = request;
    sendProgress(id, 0.1, "Fetching audio file");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
    }
    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    sendProgress(id, 0.2, "Downloading audio data");
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }
    const chunks = [];
    let receivedLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      chunks.push(value);
      receivedLength += value.length;
      if (total > 0) {
        const progress = 0.2 + receivedLength / total * 0.3;
        sendProgress(id, progress, `Downloaded ${receivedLength} / ${total} bytes`);
      }
    }
    const arrayBuffer = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      arrayBuffer.set(chunk, position);
      position += chunk.length;
    }
    sendProgress(id, 0.6, "Decoding audio data");
    const audioBuffer = await decodeAudioData(arrayBuffer.buffer);
    sendProgress(id, 0.9, "Serializing audio buffer");
    const outputData = serializeAudioBuffer(audioBuffer);
    const transferables = getTransferables(outputData);
    sendProgress(id, 1, "Complete");
    sendResponse({
      type: "success",
      id,
      operation: "load",
      audioData: outputData
    }, transferables);
  } catch (error) {
    sendError(request.id, error);
  }
}
async function decodeAudio(request) {
  try {
    const { id, audioData } = request;
    sendProgress(id, 0.2, "Decoding audio data");
    const audioBuffer = await decodeAudioData(audioData);
    sendProgress(id, 0.8, "Serializing audio buffer");
    const outputData = serializeAudioBuffer(audioBuffer);
    const transferables = getTransferables(outputData);
    sendProgress(id, 1, "Complete");
    sendResponse({
      type: "success",
      id,
      operation: "decode",
      audioData: outputData
    }, transferables);
  } catch (error) {
    sendError(request.id, error);
  }
}
async function decodeAudioData(arrayBuffer) {
  throw new Error("OfflineAudioContext is not available in Web Workers. Audio decoding must be done in the main thread using AudioContext.decodeAudioData(). Consider using AudioFileLoader with decodeWithContext() instead.");
}
async function generateWaveform(request) {
  try {
    const { id, audioData, options } = request;
    sendProgress(id, 0.2, "Deserializing audio buffer");
    const audioBuffer = deserializeAudioBuffer(audioData);
    validateAudioBuffer(audioBuffer);
    sendProgress(id, 0.4, "Generating waveform");
    const samples = options?.samples ?? 1e3;
    const channel = options?.channel ?? 0;
    const useRMS = options?.useRMS ?? false;
    const waveformData = downsampleAudioBuffer(audioBuffer, samples, channel, useRMS);
    sendProgress(id, 1, "Complete");
    sendResponse({
      type: "success",
      id,
      operation: "waveform",
      waveformData,
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration
    }, [waveformData.buffer]);
  } catch (error) {
    sendError(request.id, error);
  }
}
async function analyzeAudio(request) {
  const { id } = request;
  sendError(id, new Error("OfflineAudioContext is not available in Web Workers. Audio analysis must be done in the main thread using AudioContext and AnalyserNode."));
  return;
}
self.onmessage = async (event) => {
  const request = event.data;
  if (isTerminated) {
    sendError(request.id, "Worker has been terminated");
    return;
  }
  try {
    switch (request.type) {
      case "process":
        await processAudio(request);
        break;
      case "load":
        await loadAudio(request);
        break;
      case "decode":
        await decodeAudio(request);
        break;
      case "waveform":
        await generateWaveform(request);
        break;
      case "analyze":
        await analyzeAudio(request);
        break;
      case "terminate":
        isTerminated = true;
        self.close();
        break;
      default:
        const unknownRequest = request;
        sendError(unknownRequest.id || "unknown", `Unknown request type: ${unknownRequest.type}`);
    }
  } catch (error) {
    sendError(request.id, error);
  }
};
sendResponse({ type: "ready" });
//# sourceMappingURL=audio-processor.worker.bundle.js.map
