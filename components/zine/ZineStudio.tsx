import { useCallback, useEffect, useRef, useState } from "react";
import Home from "@/app/page";
import { uid, type World } from "@/lib/world";
import type { PlayerAudioFrame } from "@/lib/audio/game-parameters";
import { Cover } from "./Cover";
import {
  fileLeaf,
  isFiled,
  linkTo,
  newLeaf,
  readLink,
  sectors,
  shelf,
  type Leaf,
  type Trail,
} from "./pages";
import "./zine.css";

type View =
  | "editor"
  | "shelf"
  | "compose"
  | "sent"
  | "cover"
  | "walk"
  | "reply"
  | "returned"
  | "file"
  | "loading"
  | "error";
const folio = (n: number) => String(n).padStart(2, "0");

function Book({ leaf }: { leaf: Leaf }) {
  return (
    <div className={"z-book" + (leaf.trail ? " z-reply-book" : "")}>
      <div className="z-imprint">
        <i>Whistle</i>
        <span>{leaf.trail ? "흔적 면" : "세계 면"}</span>
      </div>
      <Cover leaf={leaf} />
      <div className="z-book-title">{leaf.title || "이름 없는 면"}</div>
    </div>
  );
}

export default function ZineStudio() {
  const [leaves, setLeaves] = useState(() => {
    const items = shelf();
    return items.length ? items : [newLeaf(true)];
  });
  const [active, setActive] = useState(
    () => leaves.find((l) => !l.trail)?.id ?? leaves[0].id,
  );
  const current = leaves.find((l) => l.id === active) ?? leaves[0];
  const [view, setView] = useState<View>(() =>
    location.hash ? "loading" : current.trail ? "shelf" : "editor",
  );
  const [guest, setGuest] = useState<Leaf | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [score, setScore] = useState("");
  const trace = useRef<Trail>([]);
  const beforeLink = useRef<View>("editor");
  const currentRef = useRef(current);
  currentRef.current = current;
  const save = useCallback((leaf: Leaf) => {
    try {
      fileLeaf(leaf);
    } catch {
      setMessage(
        "브라우저 저장 공간이 부족합니다. 이 창을 열어 둔 채 면 링크를 복사해 주세요.",
      );
    }
    setLeaves((old) =>
      old.some((l) => l.id === leaf.id)
        ? old.map((l) => (l.id === leaf.id ? leaf : l))
        : [...old, leaf],
    );
  }, []);
  const edit = useCallback(
    (world: World) => {
      const old = currentRef.current;
      if (old.world !== world || !isFiled(old)) save({ ...old, world });
    },
    [save],
  );

  useEffect(() => {
    let generation = 0;
    const read = async () => {
      const token = ++generation;
      setMessage("");
      setCopied(false);
      if (!location.hash) {
        setView(beforeLink.current);
        return;
      }
      setView("loading");
      try {
        const leaf = await readLink(location.hash);
        if (token !== generation) return;
        setGuest(leaf);
        setView(leaf.trail ? "file" : "cover");
      } catch {
        if (token === generation) {
          setMessage(
            "면 링크를 읽을 수 없습니다. 건넨 사람에게 링크 전체를 다시 받아 주세요.",
          );
          setView("error");
        }
      }
    };
    if (location.hash) void read();
    window.addEventListener("hashchange", read);
    return () => {
      generation++;
      window.removeEventListener("hashchange", read);
    };
  }, []);
  function goShelf() {
    history.replaceState(null, "", location.pathname + location.search);
    const saved = shelf();
    if (saved.length) setLeaves(saved);
    setMessage("");
    setView("shelf");
  }
  function open(leaf: Leaf) {
    setMessage("");
    setActive(leaf.id);
    if (leaf.trail) {
      setGuest(leaf);
      setView("file");
    } else setView("editor");
  }
  function add() {
    const leaf = newLeaf();
    save(leaf);
    setActive(leaf.id);
    setView("editor");
    setMessage("");
  }
  function compose() {
    setTitle(current.title);
    setScore(current.score);
    setMessage("");
    setView("compose");
  }
  async function issue(leaf: Leaf, next: "sent" | "returned") {
    setBusy(true);
    setMessage("");
    setCopied(false);
    try {
      const url = await linkTo(leaf);
      if (next === "sent") save(leaf);
      setGuest(leaf);
      setLink(url);
      setView(next);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "링크를 만들 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }
  function previewLink() {
    beforeLink.current = view;
    if (new URL(link).hash === location.hash) {
      setView(guest?.trail ? "file" : "cover");
      return;
    }
    location.hash = new URL(link).hash;
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setMessage("아래 주소를 선택해 복사해 주세요.");
    }
  }
  function record(f: PlayerAudioFrame) {
    const t = trace.current,
      last = t.at(-1);
    if (f.falling || !f.grounded) {
      if (last) t.push(null);
      return;
    }
    if (last && Math.hypot(last[0] - f.x, last[1] - f.z) < 0.06) return;
    if (t.length >= 2398) return;
    t.push([Math.round(f.x * 100) / 100, Math.round(f.z * 100) / 100]);
  }
  function endWalk() {
    const trail = trace.current;
    if (!guest) return;
    if (!trail.some((p, i) => p && i > 0 && trail[i - 1] !== null)) {
      setMessage("조금 걸은 뒤 연주를 마치면 흔적을 남길 수 있습니다.");
      setView("cover");
      return;
    }
    setGuest({ ...guest, id: uid(), sourceId: guest.id, trail: [...trail] });
    setView("reply");
  }
  function collect() {
    if (!guest) return;
    save(guest);
    const filed = shelf();
    if (filed.some((l) => l.id === guest.id)) setLeaves(filed);
    setActive(guest.id);
    history.replaceState(null, "", location.pathname + location.search);
    setView("shelf");
    setMessage("흔적 면을 내 진에 끼웠습니다.");
  }
  const walk = view === "walk" && guest;
  const onDesk = view === "editor";
  const draft = view === "compose" ? { ...current, title, score } : guest;
  const index = leaves.findIndex((l) => l.id === current.id) + 1;
  const activeEdition =
    !!guest && leaves.some((l) => l.id === guest.id && l.trail);
  return (
    <div className="zine">
      {!walk && (
        <header className="z-mast">
          <button
            className="z-wordmark"
            onClick={goShelf}
            aria-label="Whistle 진 펼치기"
          >
            Whistle<span>✳</span>
          </button>
          <nav>
            <button className="z-textbtn" onClick={goShelf}>
              진 펼치기
            </button>
            {onDesk && (
              <button className="z-primary" onClick={compose}>
                건네기 <span>↗</span>
              </button>
            )}
          </nav>
        </header>
      )}
      {message && (
        <p className="z-message" role="status">
          {message}
        </p>
      )}
      {onDesk && (
        <div className="z-desk">
          <div className="z-desk-head">
            <div>
              <small>편집 중인 면</small>
              <h1>{current.title}</h1>
            </div>
            <span className="z-page-no">면 {folio(index)}</span>
          </div>
          <Home
            key={current.id}
            folio={{ world: current.world, onEdit: edit }}
          />
          <nav className="z-strip" aria-label="진의 면 순서">
            <span>내 진</span>
            {leaves.map((leaf, i) => (
              <button
                key={leaf.id}
                aria-current={leaf.id === current.id ? "page" : undefined}
                onClick={() => open(leaf)}
              >
                <span>{folio(i + 1)}</span>{" "}
                {leaf.trail ? "걸은 흔적" : leaf.title}
              </button>
            ))}
            <button className="z-add" onClick={add}>
              ＋ 새 면
            </button>
          </nav>
        </div>
      )}
      {view === "shelf" && (
        <main className="z-shelf">
          <div className="z-section-head">
            <h1>진 펼치기</h1>
            <span>{leaves.length}개의 면</span>
          </div>
          <div className="z-collection">
            {leaves.map((leaf, i) => (
              <button
                className="z-shelf-item"
                key={leaf.id}
                onClick={() => open(leaf)}
              >
                <Book leaf={leaf} />
                <div className="z-caption">
                  <b>{folio(i + 1)}</b>
                  <span>{leaf.trail ? "돌아온 흔적" : "내가 만든 세계"}</span>
                </div>
              </button>
            ))}
            <button className="z-new-sheet" onClick={add}>
              <span>＋</span>새 면
            </button>
          </div>
        </main>
      )}
      {draft &&
        !walk &&
        ["compose", "sent", "cover", "reply", "returned", "file"].includes(
          view,
        ) && (
          <main className="z-spread">
            <div className="z-print-side">
              <Book leaf={draft} />
            </div>
            <div className="z-copy-side">
              {view === "compose" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void issue(
                      {
                        ...current,
                        title: title.trim() || "이름 없는 면",
                        score: score.trim(),
                      },
                      "sent",
                    );
                  }}
                >
                  <small>내 진 · 면 {folio(index)}</small>
                  <h1>한 면 건네기</h1>
                  <label>
                    면의 이름
                    <input
                      value={title}
                      maxLength={80}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    연주할 사람에게 남기는 한 줄
                    <textarea
                      value={score}
                      maxLength={300}
                      placeholder="숲 가장자리를 걷다가, 물이 보이면 잠깐 멈춰 주세요."
                      onChange={(e) => setScore(e.target.value)}
                    />
                  </label>
                  <div className="z-actions">
                    <button className="z-primary" disabled={busy}>
                      {busy ? "준비 중…" : "이 면의 링크 만들기 ↗"}
                    </button>
                    <button type="button" onClick={() => setView("editor")}>
                      편집으로
                    </button>
                  </div>
                </form>
              )}
              {(view === "sent" || view === "returned") && (
                <section>
                  <small>{view === "sent" ? "세계 면" : "흔적 면"}</small>
                  <h1>
                    {view === "sent"
                      ? "건넬 준비가 됐어요"
                      : "돌려줄 면이 준비됐어요"}
                  </h1>
                  <p>
                    {view === "sent"
                      ? "링크를 받은 사람은 이 면을 열어 연주할 수 있습니다."
                      : "이 링크를 만든 사람에게 건네면, 걸은 흔적을 진에 끼울 수 있습니다."}
                  </p>
                  <label>
                    면 링크
                    <input
                      readOnly
                      value={link}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <div className="z-actions">
                    <button className="z-primary" onClick={copy}>
                      {copied ? "링크 복사됨" : "링크 복사"}
                    </button>
                    <button onClick={previewLink}>받는 화면 열기 ↗</button>
                  </div>
                </section>
              )}
              {view === "cover" && (
                <section>
                  <small>건네받은 세계 면</small>
                  <h1>{draft.title}</h1>
                  {draft.score && <blockquote>{draft.score}</blockquote>}
                  <p>
                    방향키로 걷고 화면을 드래그해 둘러보세요. 걸은 길은 한
                    면으로 돌려줄 수 있습니다.
                  </p>
                  <button
                    className="z-primary"
                    onClick={() => {
                      trace.current = [];
                      setMessage("");
                      setView("walk");
                    }}
                  >
                    연주하기 →
                  </button>
                </section>
              )}
              {(view === "reply" || view === "file") && (
                <section>
                  <small>
                    {view === "reply" ? "방금 걸은 흔적" : "돌아온 흔적 면"}
                  </small>
                  <h1>{view === "reply" ? "걸은 길 돌려주기" : draft.title}</h1>
                  <div className="z-route">
                    <i />
                    지나간 구역{" "}
                    <strong>
                      {sectors(draft.trail ?? [], draft.world.size)}
                    </strong>
                  </div>
                  {draft.score && <blockquote>{draft.score}</blockquote>}
                  {view === "reply" ? (
                    <button
                      className="z-primary"
                      disabled={busy}
                      onClick={() => void issue(draft, "returned")}
                    >
                      흔적 면 돌려주기 ↗
                    </button>
                  ) : (
                    <button
                      className="z-primary"
                      onClick={activeEdition ? goShelf : collect}
                    >
                      {activeEdition ? "내 진 펼치기" : "내 진에 끼우기 ＋"}
                    </button>
                  )}
                </section>
              )}
            </div>
          </main>
        )}
      {walk && (
        <Home
          folio={{ world: walk.world, onFootstep: record, finishWalk: endWalk }}
        />
      )}
      {view === "loading" && <p className="z-message">면을 펼치고 있습니다…</p>}
      {view === "error" && (
        <button className="z-primary" onClick={goShelf}>
          내 진 펼치기
        </button>
      )}
    </div>
  );
}
