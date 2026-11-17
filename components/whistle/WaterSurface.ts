import * as THREE from "three";

const waterNoise = `
  float waterHash(vec2 p){
    vec3 q=fract(vec3(p.xyx)*.1031);
    q+=dot(q,q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
  }
  vec3 waterNoise(vec2 p){
    vec2 cell=floor(p), f=fract(p);
    float a=waterHash(cell), b=waterHash(cell+vec2(1.,0.));
    float c=waterHash(cell+vec2(0.,1.)), d=waterHash(cell+vec2(1.,1.));
    vec2 u=f*f*f*(f*(f*6.-15.)+10.);
    vec2 du=30.*f*f*(f*(f-2.)+1.);
    float crossTerm=a-b-c+d;
    return vec3(a+(b-a)*u.x+(c-a)*u.y+crossTerm*u.x*u.y,
      du*vec2(b-a+crossTerm*u.y,c-a+crossTerm*u.x));
  }
`;

export function makeWaterSurface(
  geometry: THREE.BufferGeometry,
  level: number,
  clock: { value: number },
) {
  const material = new THREE.ShaderMaterial({ transparent: false, depthWrite: true, fog: true });
  const water = new THREE.Mesh(geometry, material);
  water.name = "generated-water";
  water.userData.waterLevel = level;
  Object.assign(
    material.uniforms,
    THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    {
      waterTime: clock,
      waveStrength: { value: 1 }, rainPower: { value: 0 }, waterMotion: { value: 1 },
      surfaceDrift: { value: new THREE.Vector2() },
      skyTint: { value: new THREE.Color("#ffffff") },
      lightPower: { value: 1 },
      sunVector: { value: new THREE.Vector3(-1, 2, 1).normalize() },
      reflectionMap: { value: null },
      reflectionMatrix: { value: new THREE.Matrix4() },
      hasReflection: { value: 0 },
    },
  );
  material.vertexShader = `
    uniform float waterTime, waveStrength, waterMotion;
    attribute float waterDepth;
    varying float depth;
    uniform mat4 reflectionMatrix;
    varying vec4 reflectionPosition;
    varying vec3 waterWorldPosition;
    #include <common>
    #include <fog_pars_vertex>
    ${waterNoise}
    void main(){
      depth=waterDepth;
      vec3 displaced=position;
      float t=waterTime*waterMotion;
      float swell=waterNoise(position.xz*.65+vec2(t*.06,t*.025)).x-.5;
      displaced.y+=swell*.025*(waveStrength-1.)*smoothstep(.05,.25,depth);
      waterWorldPosition=(modelMatrix*vec4(displaced,1.0)).xyz;
      reflectionPosition=reflectionMatrix*vec4(waterWorldPosition,1.0);
      vec4 mvPosition=modelViewMatrix*vec4(displaced,1.0);
      gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
    }`;
  material.fragmentShader = `
    varying float depth;
    uniform float waterTime, lightPower, waveStrength, rainPower, waterMotion;
    uniform vec2 surfaceDrift;
    uniform vec3 skyTint, sunVector;
    uniform sampler2D reflectionMap;
    uniform float hasReflection;
    varying vec4 reflectionPosition;
    varying vec3 waterWorldPosition;
    #include <common>
    #include <fog_pars_fragment>
    ${waterNoise}
    void main(){
      float t=waterTime*waterMotion;
      vec2 p=waterWorldPosition.xz+surfaceDrift*t*.18;
      mat2 turn=mat2(.8,-.6,.6,.8), fineTurn=mat2(.28,.96,-.96,.28);
      vec3 swell=waterNoise(p*.65+vec2(t*.06,t*.025));
      vec3 ripple=waterNoise(turn*p*2.4-vec2(t*.075,t*.045)+swell.x*.7);
      vec3 detail=waterNoise(fineTurn*p*7.1+vec2(t*.11,-t*.09)+ripple.x*.35);
      vec2 slope=swell.yz*.055
        +vec2(dot(turn[0],ripple.yz),dot(turn[1],ripple.yz))*.032
        +vec2(dot(fineTurn[0],detail.yz),dot(fineTurn[1],detail.yz))*.012;
      slope*=waveStrength;
      if(rainPower>.001) for(int layer=0;layer<2;layer++){
        vec2 rainP=p*(2.3+float(layer)*1.4)+float(layer)*vec2(17.3,9.7);
        vec2 rainCell=floor(rainP);
        float seed=waterHash(rainCell+12.7);
        vec2 drop=fract(rainP)-(.3+.4*vec2(waterHash(rainCell),waterHash(rainCell+41.3)));
        float phase=fract(t*(.62+seed*.35)+seed), radius=length(drop);
        float ring=sin((radius-phase*.26)*95.)*exp(-pow((radius-phase*.26)*45.,2.))*pow(1.-phase,2.);
        slope+=drop/max(radius,.01)*ring*rainPower*.012;
      }
      vec3 n=normalize(vec3(-slope.x,1.0,-slope.y));
      vec3 v=normalize(cameraPosition-waterWorldPosition);
      float fresnel=.035+.965*pow(1.0-max(dot(n,v),0.0),5.0);
      vec3 reflectedDirection=reflect(-v,n);
      vec3 reflected=skyTint*mix(vec3(.9,.95,1.0),vec3(.72,.83,.94),clamp(reflectedDirection.y,0.0,1.0));
      if(hasReflection>.5 && reflectionPosition.w>0.0){
        vec2 reflectionUv=reflectionPosition.xy/reflectionPosition.w+slope*.012;
        float edge=smoothstep(0.0,.035,min(min(reflectionUv.x,reflectionUv.y),min(1.0-reflectionUv.x,1.0-reflectionUv.y)));
        vec3 mirror=texture2D(reflectionMap,clamp(reflectionUv,vec2(.002),vec2(.998))).rgb;
        reflected=mix(reflected,mirror,edge*.92);
      }
      float glint=pow(max(dot(n,normalize(v+sunVector)),0.0),96.0)*lightPower;
      float transmission=exp(-max(depth,0.0)*2.2);
      vec3 bed=mix(vec3(.045,.14,.17),vec3(.36,.53,.55),transmission)*(.3+lightPower*.55);
      float caustic=smoothstep(.65,.9,detail.x*.55+ripple.x*.45)*transmission*.012*lightPower;
      vec3 color=mix(bed+caustic,reflected,clamp(.15+fresnel*.82,.0,.96))+vec3(glint*.36);
      gl_FragColor=vec4(color,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`;
  water.onBeforeRender = (_renderer, scene) => {
    if (scene.background instanceof THREE.Color)
      material.uniforms.skyTint.value.copy(scene.background);
    const sun = scene.getObjectByName("whistle-sun") as
      | THREE.DirectionalLight
      | undefined;
    const moon = scene.getObjectByName("whistle-moon") as
      | THREE.DirectionalLight
      | undefined;
    const light = sun && sun.intensity > 0.05 ? sun : moon;
    if (light) {
      material.uniforms.sunVector.value.copy(light.position).normalize();
      material.uniforms.lightPower.value = light.intensity;
    }
  };
  return water;
}
