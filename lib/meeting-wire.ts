const PREFIX = "whistle-media:";
const MEDIA_KEYS = new Set(["image", "originalImage", "data"]);
const MAX_MEDIA_BYTES = 128 * 1024 * 1024;

// Each WebSocket owns a fresh cache; reconnects send their media again.
export function createMeetingCodec() {
  const outgoing = new Map<string, string>(), incoming = new Map<string, string>();
  let sequence = 0, incomingBytes = 0, outgoingBytes = 0;
  const encode = (message: unknown): string[] => {
    const media: string[] = [];
    const pending = new Map<string, string>();
    let addedBytes = 0;
    const snapshot = ["state", "publish"].includes((message as {type?: string}).type ?? "");
    const used = new Set<string>();
    const payload = JSON.stringify(message, (key, value) => {
      if (!MEDIA_KEYS.has(key) || typeof value !== "string" || !/^data:(image|audio)\//.test(value)) return value;
      used.add(value);
      let id = outgoing.get(value) ?? pending.get(value);
      if (!id) {
        addedBytes += value.length;

        id = `${PREFIX}${++sequence}`;
        pending.set(value, id);
        media.push(JSON.stringify({ type: "media", id, data: value }));
      }
      return id;
    });
    const dropped: string[] = [];
    const removed = snapshot ? [...outgoing].filter(([data]) => !used.has(data)) : [];
    const retainedBytes = outgoingBytes - removed.reduce((sum,[data]) => sum + data.length, 0);
    if (retainedBytes + addedBytes > MAX_MEDIA_BYTES) throw Error("현재 재료 용량이 너무 큽니다. 사용하지 않는 재료를 삭제해 주세요.");
    for (const [data,id] of removed) { outgoing.delete(data); dropped.push(id); }
    outgoingBytes = retainedBytes;
    for (const [data,id] of pending) outgoing.set(data,id);
    outgoingBytes += addedBytes;
    return [...(dropped.length ? [JSON.stringify({type:"media-drop",ids:dropped})] : []), ...media,payload];
  };
  const decode = <T>(raw: string): T | null => {
    const message = JSON.parse(raw);
    if (message?.type === "media-drop") {
      if (!Array.isArray(message.ids) || message.ids.length > 10000 || message.ids.some((id: unknown) => typeof id !== "string")) throw Error("잘못된 캐시 갱신입니다.");
      for (const id of message.ids) { const data = incoming.get(id); if (data !== undefined) { incomingBytes -= data.length; incoming.delete(id); } }
      return null;
    }
    if (message?.type === "media") {
      if (typeof message.id !== "string" || !/^whistle-media:\d{1,8}$/.test(message.id) ||
        typeof message.data !== "string" || !/^data:(image|audio)\//.test(message.data)) throw Error("재료 데이터를 읽을 수 없습니다.");
      const previous = incoming.get(message.id);
      if (previous !== undefined) {
        if (previous !== message.data) throw Error("재료 데이터가 일치하지 않습니다.");
        return null;
      }
      if (incomingBytes + message.data.length > MAX_MEDIA_BYTES) throw Error("재료 용량이 너무 큽니다.");
      incomingBytes += message.data.length;
      incoming.set(message.id,message.data);
      return null;
    }
    const resolve = (value: unknown, key = ""): unknown => {
      if (MEDIA_KEYS.has(key) && typeof value === "string" && value.startsWith(PREFIX)) {
        const media = incoming.get(value);
        if (media === undefined) throw Error("재료를 받지 못했습니다. 다시 접속해 주세요.");
        return media;
      }
      if (Array.isArray(value)) return value.map(item => resolve(item));
      if (value && typeof value === "object") for (const [name,child] of Object.entries(value))
        (value as Record<string,unknown>)[name] = resolve(child,name);
      return value;
    };
    return resolve(message) as T;
  };
  return { encode, decode };
}
