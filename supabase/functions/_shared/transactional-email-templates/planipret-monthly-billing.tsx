import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const money = (n: number) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(Number(n) || 0)
const monthLabel = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const th: React.CSSProperties = { background: '#0023e6', color: '#ffffff', fontSize: 12, padding: '8px 6px', textAlign: 'left' }
const td: React.CSSProperties = { fontSize: 12, padding: '7px 6px', borderBottom: '1px solid #e5e7eb', color: '#111827' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right' }
const tot: React.CSSProperties = { ...tdR, fontWeight: 700, background: '#f3f4f6' }

const MonthlyBilling = ({ report }: { report?: any }) => {
  const r = report ?? { plans: [], services: [], totals: {} }
  const t = r.totals ?? {}
  return (
    <Html lang="fr" dir="ltr">
      <Head />
      <Preview>Bilan mensuel AVA Statistic — {monthLabel(r.period_start)}</Preview>
      <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }}>
        <Container style={{ padding: '24px 20px', maxWidth: 680 }}>
          <Heading style={{ fontSize: 20, color: '#0023e6', margin: '0 0 6px' }}>Bilan mensuel — {monthLabel(r.period_start)}</Heading>
          <Text style={{ fontSize: 13, color: '#4b5563', margin: '0 0 18px' }}>
            Utilisateurs existants comparés aux ajouts du mois, par forfait, avec files d'attente et IVR.
          </Text>

          <Section>
            <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Forfait</th><th style={th}>Existants</th><th style={th}>Ajoutés</th><th style={th}>Total</th>
                <th style={th}>Prix</th><th style={th}>Coût</th><th style={th}>Facturé</th><th style={th}>Marge</th>
              </tr></thead>
              <tbody>
                {r.plans.map((p: any) => (
                  <tr key={p.plan}>
                    <td style={td}>{p.label}</td><td style={tdR}>{p.existing}</td><td style={tdR}>{p.added}</td><td style={tdR}>{p.total}</td>
                    <td style={tdR}>{money(p.unit_price)}</td><td style={tdR}>{money(p.cost)}</td><td style={tdR}>{money(p.revenue)}</td><td style={tdR}>{money(p.margin)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...tot, textAlign: 'left' }}>Total</td><td style={tot}>{(t.users ?? 0) - (t.users_added ?? 0)}</td><td style={tot}>{t.users_added ?? 0}</td><td style={tot}>{t.users ?? 0}</td>
                  <td style={tot}></td><td style={tot}>{money(t.plan_cost)}</td><td style={tot}>{money(t.plan_revenue)}</td><td style={tot}>{money(t.plan_margin)}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Heading as="h2" style={{ fontSize: 15, color: '#111827', margin: '22px 0 8px' }}>Files d'attente & IVR</Heading>
          <Section>
            <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Service</th><th style={th}>Existants</th><th style={th}>Ajoutés</th><th style={th}>Total</th>
                <th style={th}>Mensuel (premier gratuit)</th><th style={th}>Activation (100 $)</th>
              </tr></thead>
              <tbody>
                {r.services.map((s: any) => (
                  <tr key={s.kind}>
                    <td style={td}>{s.label}{s.added_names?.length ? ` — nouveaux : ${s.added_names.join(', ')}` : ''}</td>
                    <td style={tdR}>{s.existing}</td><td style={tdR}>{s.added}</td><td style={tdR}>{s.total}</td>
                    <td style={tdR}>{money(s.monthly)}</td><td style={tdR}>{money(s.activation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section style={{ marginTop: 20, padding: 14, background: '#f3f4f6', borderRadius: 8 }}>
            <Text style={{ fontSize: 13, margin: '2px 0' }}>Récurrent mensuel : <b>{money(t.monthly_recurring)}</b></Text>
            <Text style={{ fontSize: 13, margin: '2px 0' }}>Frais d'activation (une fois) : <b>{money(t.activation_one_time)}</b></Text>
            <Text style={{ fontSize: 15, margin: '6px 0 0', color: '#0023e6' }}>Total à facturer : <b>{money(t.total_billed)}</b></Text>
          </Section>
          <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 18 }}>AVA Statistic — rapport généré automatiquement le 1er du mois.</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: MonthlyBilling,
  subject: (d: Record<string, any>) => `Bilan mensuel AVA Statistic — ${monthLabel(d?.report?.period_start)}`,
  displayName: 'Bilan mensuel Planiprêt',
  previewData: {
    report: {
      period_start: '2026-10-01',
      plans: [
        { plan: 'widget', label: 'Widget seulement', existing: 10, added: 0, total: 10, unit_price: 49.95, cost: 189.9, revenue: 499.5, margin: 309.6 },
        { plan: 'mobile', label: 'Widget + App (sans AVA)', existing: 0, added: 1, total: 1, unit_price: 79, cost: 30, revenue: 79, margin: 49 },
        { plan: 'ai', label: 'Kit complet (App + AVA)', existing: 80, added: 0, total: 80, unit_price: 99.95, cost: 4000, revenue: 7996, margin: 3996 },
      ],
      services: [
        { kind: 'queue', label: "Files d'attente", existing: 2, added: 1, total: 3, added_names: ['Ventes'], monthly: 23.98, activation: 100 },
        { kind: 'ivr', label: 'IVR', existing: 1, added: 0, total: 1, added_names: [], monthly: 0, activation: 0 },
      ],
      totals: { users: 91, users_added: 1, plan_cost: 4219.9, plan_revenue: 8574.5, plan_margin: 4354.6, monthly_recurring: 4243.88, activation_one_time: 100, total_billed: 4343.88 },
    },
  },
} satisfies TemplateEntry
