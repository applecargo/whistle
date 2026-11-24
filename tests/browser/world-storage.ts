import type { Page } from "@playwright/test";
import type { World } from "../../lib/world";

export async function savedDocument(page:Page):Promise<World | undefined> {
  return page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open("whistle-browser-worlds",1);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    try {
      const get=(key:string)=>new Promise<any>((resolve,reject)=>{
        const request=db.transaction("worlds").objectStore("worlds").get(key);
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      const tab=sessionStorage.getItem("whistle.document.tab");
      if(tab){const own=await get(JSON.stringify(["document",tab]));if(own)return own;}
      const key=await get(JSON.stringify(["document","latest"]));
      return key?await get(key):undefined;
    } finally {db.close();}
  });
}
export async function savedWorld(page:Page):Promise<World> {
  return (await savedDocument(page))!;
}
