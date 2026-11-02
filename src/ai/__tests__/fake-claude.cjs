// 测试用的假 Claude Code：读标准输入，按 FAKE_MODE 返回不同结果
const fs = require("node:fs");
const path = require("node:path");
let input = "";
process.stdin.setEncoding("utf8").on("data", (d) => { input += d; }).on("end", () => {
  const mode = process.env.FAKE_MODE;
  const counter = path.join(process.cwd(), "count.txt");
  const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0) + 1;
  fs.writeFileSync(counter, String(n));
  fs.writeFileSync(path.join(process.cwd(), `prompt-${n}.txt`), input);
  fs.writeFileSync(path.join(process.cwd(), `args-${n}.txt`), JSON.stringify(process.argv.slice(2)));
  if (mode === "error") { process.stdout.write(JSON.stringify({ type: "result", is_error: true, result: "Not logged in · Please run /login" })); process.exit(1); }
  if (mode === "hang") { setTimeout(() => {}, 60000); return; }
  const good = fs.readFileSync(path.join(__dirname, "../../../data/seed/circuits/breaker-control-basic.json"), "utf8");
  let body = good;
  if (mode === "fix" && n === 1) {
    const c = JSON.parse(good);
    delete c.layout.HQ; // 第一次故意漏掉一个布局
    body = JSON.stringify(c);
  }
  const result = `我按通用原理写的，TODO(待沈确认)：合闸线圈的阻值档位。\n\n\`\`\`json\n${body}\n\`\`\``;
  process.stdout.write(JSON.stringify({ type: "result", is_error: false, result, total_cost_usd: 0.01 }));
});
