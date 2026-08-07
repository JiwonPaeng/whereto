export function LegalPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-narrow px-4 py-8 lg:py-12">
      <h1 className="text-2xl font-bold text-brand">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
      <div className="mt-6 space-y-6 text-sm leading-relaxed">{children}</div>
    </main>
  );
}

export function Article({ no, title, children }: { no: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-base font-bold text-fg">
        {no} {title}
      </h2>
      <div className="space-y-2 text-fg-muted">{children}</div>
    </section>
  );
}

export function Ol({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>;
}

export function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1 pl-5">{children}</ul>;
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-line-strong bg-surface-sunken px-3 py-2 text-fg">
      {children}
    </p>
  );
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-xs">
        <thead className="bg-surface-sunken text-2xs text-fg-subtle">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-2 py-1.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
