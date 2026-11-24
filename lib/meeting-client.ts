import { MEETING_PATH } from "./meeting.ts";

export function meetingSocketURL(page:URL, endpoint?:string) {
  const url=new URL(endpoint || MEETING_PATH,page);
  if(url.protocol==="https:")url.protocol="wss:";
  else if(url.protocol==="http:")url.protocol="ws:";
  if(!["ws:","wss:"].includes(url.protocol) || page.protocol==="https:"&&url.protocol!=="wss:")
    throw Error("연결 서버 주소가 올바르지 않습니다.");
  url.hash="";
  return url;
}
