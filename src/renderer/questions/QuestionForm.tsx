import { useState } from "react";
import type { Question, QuestionInput, QType, ReviewStatus } from "../../questions/model";
import { QTYPE_LABEL, STATUS_LABEL, SOURCE_LABEL, letter } from "../../questions/model";
import { Modal } from "../components/Modal";
import { call } from "../lib";

/** 新建 / 编辑题目。排序题在表单里按正确顺序排列选项。 */
export function QuestionForm({ question, onClose, onSaved }: {
  question: Question | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const init = () => {
    if (!question) return { qtype: "single" as QType, stem: "", options: ["", "", "", ""], answer: 0 as QuestionInput["answer"], explanation: "", tags: "", review_status: "draft" as ReviewStatus };
    let options = [...question.options];
    let answer = question.answer;
    if (question.qtype === "order") { options = (question.answer as number[]).map((i) => question.options[i]); answer = options.map((_, i) => i); }
    return { qtype: question.qtype, stem: question.stem, options, answer, explanation: question.explanation, tags: question.tags.join("、"), review_status: question.review_status };
  };
  const [v, setV] = useState(init);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));

  const changeType = (qtype: QType) => {
    const options = qtype === "judge" ? [] : v.options.length >= 2 ? v.options : ["", "", "", ""];
    const answer = qtype === "judge" ? true : qtype === "multi" ? [] : qtype === "order" ? options.map((_, i) => i) : 0;
    set({ qtype, options, answer });
  };
  const setOption = (i: number, text: string) => set({ options: v.options.map((o, j) => (j === i ? text : o)) });
  const addOption = () => set({ options: [...v.options, ""], answer: v.qtype === "order" ? [...v.options.map((_, i) => i), v.options.length] : v.answer });
  const removeOption = (i: number) => {
    const options = v.options.filter((_, j) => j !== i);
    let answer = v.answer;
    if (v.qtype === "single") answer = (v.answer as number) === i ? 0 : (v.answer as number) > i ? (v.answer as number) - 1 : v.answer;
    if (v.qtype === "multi") answer = (v.answer as number[]).filter((a) => a !== i).map((a) => (a > i ? a - 1 : a));
    if (v.qtype === "order") answer = options.map((_, j) => j);
    set({ options, answer });
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= v.options.length) return;
    const options = [...v.options];
    [options[i], options[j]] = [options[j], options[i]];
    set({ options });
  };
  const toggleMulti = (i: number) => {
    const a = v.answer as number[];
    set({ answer: a.includes(i) ? a.filter((x) => x !== i) : [...a, i].sort((x, y) => x - y) });
  };

  const save = async () => {
    setErr(null);
    setSaving(true);
    const data: Partial<QuestionInput> = {
      qtype: v.qtype, stem: v.stem, options: v.options, answer: v.answer, explanation: v.explanation,
      tags: v.tags.split(/[,，、;；\s]+/).filter(Boolean), review_status: v.review_status,
    };
    try {
      if (question) {
        const r = await call(window.api.questions.update(question.id, data));
        onSaved(r.progressReset ? "已保存。题目内容或审核状态有变化，这道题的复习进度已重置，会按新题重新安排。" : "已保存。");
      } else {
        await call(window.api.questions.create(data));
        onSaved(v.review_status === "draft" ? "已新建（草稿）。审核后才会进入复习。" : "已新建。");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={question ? `编辑题目 #${question.id}` : "新建题目"} onClose={onClose} wide>
      {question && (
        <div className="banner info small">
          修改题干、选项、答案、解析或审核状态后，这道题的复习进度会重置，按新题重新开始；只改标签不影响进度。
          来源：{SOURCE_LABEL[question.source]}，内容版本 {question.content_version}。
        </div>
      )}
      <div className="form">
        <div className="form-row">
          <label>题型</label>
          <select value={v.qtype} onChange={(e) => changeType(e.target.value as QType)}>
            {(Object.keys(QTYPE_LABEL) as QType[]).map((t) => <option key={t} value={t}>{QTYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>题干</label>
          <textarea rows={3} value={v.stem} onChange={(e) => set({ stem: e.target.value })} />
        </div>
        {v.qtype === "judge" ? (
          <div className="form-row">
            <label>答案</label>
            <div className="toolbar">
              <label className="switch"><input type="radio" checked={v.answer === true} onChange={() => set({ answer: true })} />对</label>
              <label className="switch"><input type="radio" checked={v.answer === false} onChange={() => set({ answer: false })} />错</label>
            </div>
          </div>
        ) : (
          <div className="form-row">
            <label>选项</label>
            <div>
              <p className="hint">
                {v.qtype === "single" && "选中正确答案前面的圆点。"}
                {v.qtype === "multi" && "勾选所有正确答案。"}
                {v.qtype === "order" && "按正确顺序排列（用 ↑ ↓ 调整），作答时会打乱顺序。"}
              </p>
              {v.options.map((o, i) => (
                <div key={i} className="option-edit">
                  {v.qtype === "single" && <input type="radio" checked={v.answer === i} onChange={() => set({ answer: i })} title="正确答案" />}
                  {v.qtype === "multi" && <input type="checkbox" checked={(v.answer as number[]).includes(i)} onChange={() => toggleMulti(i)} title="正确答案" />}
                  {v.qtype === "order" && <span className="order-no">{i + 1}</span>}
                  <span className="opt-letter">{letter(i)}.</span>
                  <input type="text" value={o} onChange={(e) => setOption(i, e.target.value)} />
                  {v.qtype === "order" && <><button className="link" onClick={() => move(i, -1)} disabled={i === 0}>↑</button><button className="link" onClick={() => move(i, 1)} disabled={i === v.options.length - 1}>↓</button></>}
                  <button className="link" onClick={() => removeOption(i)} disabled={v.options.length <= 2} title="删除这个选项">✕</button>
                </div>
              ))}
              <button className="link" onClick={addOption} disabled={v.options.length >= 26}>＋ 加一个选项</button>
            </div>
          </div>
        )}
        <div className="form-row">
          <label>解析</label>
          <textarea rows={3} value={v.explanation} onChange={(e) => set({ explanation: e.target.value })} placeholder="为什么是这个答案，复习时答完会显示" />
        </div>
        <div className="form-row">
          <label>标签</label>
          <div>
            <input type="text" value={v.tags} onChange={(e) => set({ tags: e.target.value })} />
            <div className="hint">多个标签用顿号或逗号隔开，例如：防跳、控制回路</div>
          </div>
        </div>
        <div className="form-row">
          <label>审核状态</label>
          <div>
            <select value={v.review_status} onChange={(e) => set({ review_status: e.target.value as ReviewStatus })}>
              {(Object.keys(STATUS_LABEL) as ReviewStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <div className="hint">只有“已审核”的题会进入复习（设置里可以改成草稿也参与）。</div>
          </div>
        </div>
      </div>
      {err && <div className="banner error">{err}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={save} disabled={saving}>保存</button>
      </div>
    </Modal>
  );
}
