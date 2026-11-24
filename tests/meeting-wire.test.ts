import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingCodec } from "../lib/meeting-wire.ts";

test("media is sent once and reused across a library, a shared world, and later terrain changes",()=>{
  const sender=createMeetingCodec(),receiver=createMeetingCodec();
  const image="data:image/png;base64,"+"a".repeat(400_000);
  const sound="data:audio/mpeg;base64,"+"b".repeat(1_280_000);
  const asset={id:"a",image},recording={data:sound};
  const message={type:"state",world:{assets:[asset]},ownWorld:{assets:[asset]},sound:recording,text:"whistle-media:1"};
  const first=sender.encode(message);
  assert.equal(first.length,3);
  assert.ok(first.at(-1)!.length<400);
  assert.equal(receiver.decode(first[0]),null);assert.equal(receiver.decode(first[1]),null);
  assert.deepEqual(receiver.decode(first[2]),message);
  const next=sender.encode({...message,revision:2});
  assert.equal(next.length,1);assert.ok(next[0].length<400);
  assert.deepEqual(receiver.decode(next[0]),{...message,revision:2});
  assert.equal(createMeetingCodec().encode(message).length,3);
});

test("missing media, conflicting identifiers, and malformed cache frames are rejected",()=>{
  const codec=createMeetingCodec();
  assert.throws(()=>codec.decode('{"image":"whistle-media:9"}'),/받지 못/);
  assert.throws(()=>codec.decode('{"type":"media","id":"bad","data":"data:image/png;base64,AA=="}'));
  const frame={type:"media",id:"whistle-media:1",data:"data:image/png;base64,AA=="};
  assert.equal(codec.decode(JSON.stringify(frame)),null);
  assert.equal(codec.decode(JSON.stringify(frame)),null);
  assert.throws(()=>codec.decode(JSON.stringify({...frame,data:"data:image/png;base64,BB=="})),/일치/);
});

test("snapshot replacement releases old media while presence messages keep live references",()=>{
  const sender=createMeetingCodec(),receiver=createMeetingCodec();
  const retained="data:image/png;base64,retained";
  for(let i=0;i<120;i++) {
    const message={type:"publish",world:{assets:[{image:retained},{sound:{data:`data:audio/mpeg;base64,${i}`+"a".repeat(1_280_000)}}]}};
    const frames=sender.encode(message);
    if(i)assert.equal(JSON.parse(frames[0]).type,"media-drop");
    let decoded;
    for(const frame of frames)decoded=receiver.decode(frame)??decoded;
    assert.deepEqual(decoded,message);
    assert.equal(sender.encode({type:"position",player:{x:1,z:1}}).length,1);
    assert.equal(sender.encode(message).length,1);
  }
  assert.throws(()=>receiver.decode('{"image":"whistle-media:2"}'),/받지 못/);
  assert.throws(()=>receiver.decode('{"type":"media-drop","ids":[1]}'));
});
