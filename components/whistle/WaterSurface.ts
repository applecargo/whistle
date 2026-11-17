import * as THREE from "three";


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
    void main(){
      depth=waterDepth;
      vec3 displaced=position;
      float t=waterTime*waterMotion;
      displaced.y+=sin(position.x*2.1+position.z*1.3+t*.65)*.018*(waveStrength-1.)*smoothstep(.05,.25,depth);
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
    void main(){
      float t=waterTime*waterMotion;
      vec2 p=waterWorldPosition.xz+surfaceDrift*t*.18;
      float a=dot(p,vec2(2.1,1.3))+t*.65;
      float b=dot(p,vec2(-3.4,4.7))-t*.8;
      float c=dot(p,vec2(11.8,7.3))+sin(a)*.65+t*1.1;
      float d=dot(p,vec2(-17.1,12.2))-t*1.35;
      vec2 slope=vec2(2.1,1.3)*cos(a)*.025+vec2(-3.4,4.7)*cos(b)*.012
        +vec2(11.8,7.3)*cos(c)*.0035+vec2(-17.1,12.2)*cos(d)*.0015;
      slope*=waveStrength;
      vec2 rainCell=floor(p*2.3), drop=fract(p*2.3)-.5;
      float seed=fract(sin(dot(rainCell,vec2(127.1,311.7)))*43758.5453);
      float phase=fract(t*.9+seed), radius=length(drop);
      float ring=sin((radius-phase*.6)*65.)*exp(-pow((radius-phase*.6)*13.,2.))*(1.-phase);
      slope+=drop/max(radius,.01)*ring*rainPower*.035;
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
      float caustic=pow(max(0.0,sin(a+b*.5)*sin(b-c*.2)),4.0)*transmission*.035*lightPower;
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
