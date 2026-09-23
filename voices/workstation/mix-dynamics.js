// Feed-forward, stereo-linked peak envelope. No look-ahead or hidden makeup gain.
// It is a vocal compressor, not a brickwall limiter or a hardware latency claim.
export function reductionDb(level,threshold,ratio,knee){const d=level-threshold;if(knee>0&&d>-knee/2&&d<knee/2)return (1/ratio-1)*(d+knee/2)**2/(2*knee);return d>knee/2?(1/ratio-1)*d:0;}
export class LinkedCompressor {
  constructor(rate){this.rate=rate;this.envelope=0;this.reduction=0;}
  coefficients(attackMs,releaseMs){return [Math.exp(-1/(Math.max(0.1,attackMs)*0.001*this.rate)),Math.exp(-1/(Math.max(10,releaseMs)*0.001*this.rate))];}
  next(peak,p,attack,release){if(!Number.isFinite(peak))peak=0;const c=peak>this.envelope?attack:release;this.envelope=c*this.envelope+(1-c)*peak;
    const reduction=reductionDb(20*Math.log10(Math.max(1e-12,this.envelope)),p.threshold,p.ratio,p.knee);this.reduction=p.enabled?reduction:0;
    return 1+Number(p.enabled)*p.blend*(Math.pow(10,(reduction+p.makeupDb)/20)-1);}
}
