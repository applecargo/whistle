export const PIXEL_PALETTE_GLSL = `
  float pixelDisplay(float value) {
    return value <= .0031308 ? value*12.92 : 1.055*pow(max(value,0.0),1.0/2.4)-.055;
  }
  float pixelLinear(float value) {
    return value <= .04045 ? value/12.92 : pow((value+.055)/1.055,2.4);
  }
  float pixelTone(float value, float threshold, float detail) {
    value=clamp(value,.025,.98);
    float low=.025, high=.15;
    if (value >= .15) { low=.15; high=.3; }
    if (value >= .3) { low=.3; high=.5; }
    if (value >= .5) { low=.5; high=.7; }
    if (value >= .7) { low=.7; high=.85; }
    if (value >= .85) { low=.85; high=.98; }
    float weight=(value-low)/(high-low);
    float dotted=mix(low,high,smoothstep(threshold-.025,threshold+.025,weight));
    return mix(value,dotted,detail);
  }
`;
