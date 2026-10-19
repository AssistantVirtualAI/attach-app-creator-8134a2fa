import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif', color: '#1A2540' }
const container = { maxWidth: 580, padding: '32px 24px' }
const heading = { color: '#0023e6', fontSize: 22 }
const button = { backgroundColor: '#0023e6', color: '#ffffff', padding: '12px 20px', borderRadius: 6 }

const FeedbackReply = ({ reportId }: { reportId?: string }) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>L’équipe a répondu à votre feedback Planiprêt.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text>AVA Statistic · Planiprêt</Text>
        <Heading style={heading}>Une réponse à votre feedback</Heading>
        <Text>L’équipe a répondu à votre signalement. Consultez la réponse dans votre application mobile ou dans le portail.</Text>
        <Button style={button} href={`https://courtierai.planipret.com/planipret/broker/feedback${reportId ? `?report=${encodeURIComponent(reportId)}` : ''}`}>
          Consulter la réponse
        </Button>
        <Text>Pour préserver la confidentialité, le contenu du signalement et de la réponse reste dans votre espace connecté.</Text>
      </Container>
    </Body>
  </Html>
)
export const template = {
  component: FeedbackReply,
  subject: 'Planiprêt — Une réponse à votre feedback',
  displayName: 'Réponse à un feedback Planiprêt',
  previewData: { reportId: '00000000-0000-4000-8000-000000000001' },
} satisfies TemplateEntry