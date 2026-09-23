import Badge from "./badge";

export default function UnderConstruction({ title, description }: { title: string; description: string }) {
  return (
    <div className="admin-page">
      <div className="flex items-center gap-3">
        <h1 className="admin-title">{title}</h1>
        <Badge tone="info">In arrivo</Badge>
      </div>
      <section className="admin-card">
        <h2>Sezione in costruzione</h2>
        <p className="admin-empty">{description}</p>
      </section>
    </div>
  );
}
