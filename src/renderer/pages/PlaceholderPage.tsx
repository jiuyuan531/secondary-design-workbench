export function PlaceholderPage(props: { title: string; milestone: string; text: string }) {
  return (
    <section>
      <h1>{props.title}</h1>
      <p className="muted">此功能在里程碑 {props.milestone} 开发：{props.text}</p>
    </section>
  );
}
