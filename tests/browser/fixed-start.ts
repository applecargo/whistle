import type { World } from "../../lib/world";
import { MEETING_START } from "../../lib/meeting";
import { flatTerrain } from "../../lib/terrain";

export function atFixedStart(world:World) {
  const dx=MEETING_START.x-world.start.x,dz=MEETING_START.z-world.start.z;
  if(!dx&&!dz)return world;
  const terrain=flatTerrain(world.size);
  world.terrain!.tiles.forEach((tile,i)=>{
    const x=i%world.size+dx,z=Math.floor(i/world.size)+dz;
    if(x>=0&&x<world.size&&z>=0&&z<world.size)terrain.tiles[z*world.size+x]=tile;
  });
  return {...world,start:{...MEETING_START},terrain:{...world.terrain!,tiles:terrain.tiles},
    objects:world.objects.map(object=>({...object,x:object.x+dx,z:object.z+dz})).filter(object=>object.x>=0&&object.x<world.size&&object.z>=0&&object.z<world.size)};
}
