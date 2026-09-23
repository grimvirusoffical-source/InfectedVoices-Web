// The capture graph is dry. End bounds are tested in audio-frame time, not a UI timer.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false; this.begin = 0; this.end = Infinity;
    this.buffer = new Float32Array(4096); this.used = 0; this.first = 0;
    this.port.onmessage = ({data}) => {
      if (data.type === 'start') {
        this.enabled = true; this.begin = data.frame; this.used = 0;
        this.end = Number.isSafeInteger(data.endFrame) && data.endFrame > data.frame ? data.endFrame : Infinity;
      }
      if (data.type === 'stop') {this.enabled = false; this.flush(); this.port.postMessage({type: 'stopped'});}
    };
  }
  flush() {
    if (!this.used) return;
    const samples = this.buffer.slice(0, this.used);
    this.port.postMessage({type: 'pcm', samples, frame: this.first}, [samples.buffer]); this.used = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input && this.enabled) {
      for (let i = 0; i < input.length; i++) {
        const frame = currentFrame + i;
        if (frame >= this.end) {this.enabled = false; this.flush(); this.port.postMessage({type: 'range-ended'}); break;}
        if (frame < this.begin) continue;
        if (!this.used) this.first = frame;
        this.buffer[this.used++] = input[i];
        if (this.used === this.buffer.length) this.flush();
      }
    }
    for (const output of outputs) for (const channel of output) channel.fill(0);
    return true;
  }
}
registerProcessor('iv-capture-v5', Capture);
