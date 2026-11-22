import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingWhistle, whistleSpatial } from "../lib/audio/meeting-whistle.ts";

test("whistle direction follows the listener heading and falls off with distance",()=>{
  const listener={x:0,z:0,yaw:0};
  assert.equal(whistleSpatial({x:3,z:0},listener).pan,1);
  assert.equal(whistleSpatial({x:-3,z:0},listener).pan,-1);
  assert.ok(Math.abs(whistleSpatial({x:3,z:0},{...listener,yaw:Math.PI/2}).pan)<1e-9);
  assert.ok(whistleSpatial({x:2,z:0},listener).gain>whistleSpatial({x:10,z:0},listener).gain);
  assert.equal(whistleSpatial(listener,listener).pan,0);
});

test("one whistle is finite, follows its source, limits voices, and releases every audio node",()=>{
  const nodes: FakeNode[]=[];
  class Param {
    value=0;
    setTargetAtTime(v:number){this.value=v;}
    setValueAtTime(v:number){this.value=v;}
    exponentialRampToValueAtTime(){}
    linearRampToValueAtTime(){}
    cancelScheduledValues(){}
  }
  class FakeNode {
    gain=new Param();pan=new Param();frequency=new Param();type="";
    started=0;stops:number[]=[];disconnected=false;onended:(()=>void)|null=null;
    constructor(){nodes.push(this);}
    connect(){} disconnect(){this.disconnected=true;}
    start(){this.started++;} stop(at=0){this.stops.push(at);}
  }
  const context={currentTime:10,state:"running",destination:{},
    createOscillator:()=>new FakeNode(),createGain:()=>new FakeNode(),createStereoPanner:()=>new FakeNode()};
  const listener={x:0,z:0,yaw:0};let source={x:4,z:0};
  const audio=createMeetingWhistle(context as unknown as AudioContext,()=>listener);
  audio.play(()=>source);
  const oscillator=nodes[0],pan=nodes[5];
  assert.equal(oscillator.started,1);assert.deepEqual(oscillator.stops,[10.36]);
  assert.equal(pan.pan.value,1);
  source={x:-4,z:0};audio.update();assert.equal(pan.pan.value,-1);
  audio.play(()=>source);audio.play(()=>source);audio.play(()=>source);
  assert.equal(nodes.length,18);
  audio.stop();assert.equal(oscillator.stops.at(-1),0);
  for(const node of nodes)node.onended?.();
  assert.ok(nodes.every(node=>node.disconnected));
  context.state="suspended";audio.play(()=>source);assert.equal(nodes.length,18);
});
