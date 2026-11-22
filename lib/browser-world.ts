import type { World } from "./world.ts";

export type BrowserWorldStore = { read():Promise<World | undefined>; write(world:World):Promise<void> };
let opening:Promise<IDBDatabase> | undefined;
function database() {
  return opening ??= new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open("whistle-browser-worlds",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("worlds");
    request.onerror=()=>{opening=undefined;reject(request.error);};
    request.onsuccess=()=>{
      const db=request.result;
      db.onversionchange=()=>{db.close();opening=undefined;};
      resolve(db);
    };
  });
}
async function read<T>(key:string):Promise<T | undefined> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const request=db.transaction("worlds","readonly").objectStore("worlds").get(key);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
export function browserWorldStore(room:string,tab:string):BrowserWorldStore {
  const key=JSON.stringify([room,tab]),latest=JSON.stringify([room,"latest"]);
  return {
    async read() {
      const own=await read<World>(key);
      if(own)return own;
      const previous=await read<string>(latest);
      return previous?read<World>(previous):undefined;
    },
    async write(world) {
      const db=await database();
      return new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction("worlds","readwrite");
        const store=transaction.objectStore("worlds");
        store.put(world,key);store.put(key,latest);
        transaction.oncomplete=()=>resolve();
        transaction.onabort=transaction.onerror=()=>reject(transaction.error);
      });
    },
  };
}
