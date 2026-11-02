import { useEffect, useMemo, useState } from "react";
import type { Question } from "../../questions/model";
import { QTYPE_LABEL, answerText, isCorrect, letter } from "../../questions/model";
import type { TodayQueue, AnswerResult } from "../../questions/repo";
import { call, today } from "../lib";

interface Card {
  q: Question;
  isNew: boolean;
  /** 答错后再练一次：不计入排期 */
  practice: boolean;
}

/** 今日复习：先到期复习，再学新题；答错的题在最后再练一次（不影响排期）。 */
export function ReviewSession({ onGoBank, onOpenSettings, onChanged }: { onGoBank: () => void; onOpenSettings: () => void; onChanged: () => void }) {
  const [queue, setQueue] = useState<TodayQueue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [pos, setPos] = useState(0);
  const [stats, setStats] = useState({ right: 0, wrong: 0 });

  const load = () => call(window.api.review.queue(today())).then(setQueue).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const start = () => {
    if (!queue) return;
    setCards([...queue.due.map((q) => ({ q, isNew: false, practice: false })), ...queue.fresh.map((q) => ({ q, isNew: true, practice: false }))]);
    setPos(0);
    setStats({ right: 0, wrong: 0 });
  };

  if (err) return <div className="banner error">{err}</div>;
  if (!queue) return <p>加载中……</p>;

  if (!cards) {
    const total = queue.due.length + queue.fresh.length;
    return (
      <div className="review-start">
        <div className="stats">
          <div className="stat"><div className="stat-num">{queue.due.length}</div><div className="stat-label">到期复习</div></div>
          <div className="stat"><div className="stat-num">{queue.fresh.length}</div><div className="stat-label">今天的新题</div></div>
          <div className="stat"><div className="stat-num">{queue.doneToday.reviews + queue.doneToday.fresh}</div><div className="stat-label">今天已完成</div></div>
        </div>
        {total > 0
          ? <button className="primary big" onClick={start}>开始复习（{total} 道）</button>
          : <p className="muted">今天没有要复习的题了。</p>}
        {queue.draftsExcluded > 0 && (
          <div className="banner info small">
            题库里有 {queue.draftsExcluded} 道草稿题没有进入复习。到 <button className="link" onClick={onGoBank}>题库</button> 里审核后（标为“已审核”）才会安排复习；
            也可以在 <button className="link" onClick={onOpenSettings}>设置 → 复习</button> 里打开“草稿题也参与复习”。
          </div>
        )}
      </div>
    );
  }

  if (pos >= cards.length) {
    return (
      <div className="review-start">
        <h2>本轮完成</h2>
        <p>答对 {stats.right} 道，答错 {stats.wrong} 道。答错的题已经安排明天再复习。</p>
        <button onClick={() => { setCards(null); load(); onChanged(); }}>返回</button>
      </div>
    );
  }

  const card = cards[pos];
  return (
    <ReviewCard key={`${pos}-${card.q.id}`} card={card} index={pos} total={cards.length}
      onDone={(correct, requeue) => {
        if (!card.practice) setStats((s) => ({ right: s.right + (correct ? 1 : 0), wrong: s.wrong + (correct ? 0 : 1) }));
        if (requeue) setCards((cs) => [...cs!, { ...card, practice: true }]);
        setPos((p) => p + 1);
      }} />
  );
}

function shuffle(n: number, seed: number): number[] {
  const a = [...Array(n).keys()];
  let s = seed || 1;
  for (let i = n - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // 打乱后恰好是正确顺序时，把前两个对调
  if (n > 1 && a.every((x, i) => x === i)) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

function ReviewCard({ card, index, total, onDone }: { card: Card; index: number; total: number; onDone: (correct: boolean, requeue: boolean) => void }) {
  const q = card.q;
  const initial = useMemo(() => (q.qtype === "order" ? shuffle(q.options.length, q.id * 7 + index) : null), [q, index]);
  const [single, setSingle] = useState<number | null>(null);
  const [multi, setMulti] = useState<number[]>([]);
  const [judge, setJudge] = useState<boolean | null>(null);
  const [order, setOrder] = useState<number[]>(initial ?? []);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const response = q.qtype === "single" ? single : q.qtype === "multi" ? [...multi].sort((a, b) => a - b) : q.qtype === "judge" ? judge : order;
  const answered = q.qtype === "single" ? single !== null : q.qtype === "multi" ? multi.length > 0 : q.qtype === "judge" ? judge !== null : true;
  const correct = submitted && isCorrect(q, response);

  const record = async (grade: number) => {
    if (card.practice) { onDone(correct, false); return; }
    try {
      setResult(await call(window.api.review.answer(q.id, response, grade, today())));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // 答错直接按“没记住”记录；答对由用户选难易
  useEffect(() => { if (submitted && !correct && !card.practice) record(1); }, [submitted]);

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const o = [...order];
    [o[i], o[j]] = [o[j], o[i]];
    setOrder(o);
  };

  const optClass = (i: number) => {
    if (!submitted) return "opt";
    const right = q.qtype === "single" ? q.answer === i : (q.answer as number[]).includes(i);
    const picked = q.qtype === "single" ? single === i : multi.includes(i);
    return `opt ${right ? "right" : picked ? "wrong" : ""}`;
  };

  return (
    <div className="review-card">
      <div className="review-meta">
        <span>第 {index + 1} / {total} 道</span>
        <span className="badge">{QTYPE_LABEL[q.qtype]}</span>
        {card.isNew && !card.practice && <span className="badge source">新题</span>}
        {card.practice && <span className="badge draft">再练一次（不计入排期）</span>}
        {q.review_status === "draft" && <span className="badge draft">草稿</span>}
        {q.tags.map((t) => <span key={t} className="badge">{t}</span>)}
      </div>
      <div className="review-stem">{q.stem}</div>

      {q.qtype === "single" && q.options.map((o, i) => (
        <label key={i} className={optClass(i)}><input type="radio" name="opt" disabled={submitted} checked={single === i} onChange={() => setSingle(i)} />{letter(i)}. {o}</label>
      ))}
      {q.qtype === "multi" && q.options.map((o, i) => (
        <label key={i} className={optClass(i)}><input type="checkbox" disabled={submitted} checked={multi.includes(i)} onChange={() => setMulti(multi.includes(i) ? multi.filter((x) => x !== i) : [...multi, i])} />{letter(i)}. {o}</label>
      ))}
      {q.qtype === "judge" && (
        <div className="toolbar">
          {[true, false].map((b) => (
            <label key={String(b)} className={`opt judge ${submitted ? (q.answer === b ? "right" : judge === b ? "wrong" : "") : ""}`}>
              <input type="radio" name="judge" disabled={submitted} checked={judge === b} onChange={() => setJudge(b)} />{b ? "对" : "错"}
            </label>
          ))}
        </div>
      )}
      {q.qtype === "order" && (
        <div>
          <p className="hint">用 ↑ ↓ 把下面几项排成正确顺序。</p>
          {order.map((oi, i) => (
            <div key={oi} className={`opt order ${submitted ? ((q.answer as number[])[i] === oi ? "right" : "wrong") : ""}`}>
              <span className="order-no">{i + 1}</span>{q.options[oi]}
              {!submitted && <span className="order-btns"><button className="link" onClick={() => move(i, -1)} disabled={i === 0}>↑</button><button className="link" onClick={() => move(i, 1)} disabled={i === order.length - 1}>↓</button></span>}
            </div>
          ))}
        </div>
      )}

      {!submitted ? (
        <div className="toolbar review-actions"><button className="primary" disabled={!answered} onClick={() => setSubmitted(true)}>提交</button></div>
      ) : (
        <>
          <div className={correct ? "banner ok" : "banner error"}>
            <b>{correct ? "答对了" : "答错了"}</b>　正确答案：{answerText(q)}
            {q.explanation && <div className="pre explain-text">{q.explanation}</div>}
          </div>
          {err && <div className="banner error">{err}</div>}
          {card.practice ? (
            <div className="toolbar review-actions"><button className="primary" onClick={() => onDone(correct, false)}>下一道</button></div>
          ) : !correct ? (
            <div className="toolbar review-actions">
              {result && <span className="muted">明天再复习这道题。</span>}
              <button className="primary" disabled={!result} onClick={() => onDone(false, true)}>记下了，下一道</button>
            </div>
          ) : !result ? (
            <div className="toolbar review-actions">
              <span className="muted">这道题对你来说：</span>
              <button onClick={() => record(3)}>有点难</button>
              <button className="primary" onClick={() => record(4)}>还行</button>
              <button onClick={() => record(5)}>很简单</button>
            </div>
          ) : (
            <div className="toolbar review-actions">
              <span className="muted">下次复习：{result.interval} 天后（{result.due_date}）</span>
              <button className="primary" onClick={() => onDone(true, false)}>下一道</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
