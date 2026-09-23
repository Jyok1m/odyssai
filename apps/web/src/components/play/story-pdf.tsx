"use client";

import type { TurnMessage, WorldView } from "@odyssai/schemas";
import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";

/*
  Le récit en PDF : les scènes du meneur, sans les phrases du joueur ni les
  réponses à ses questions, avec en tête ce qu'il faut pour savoir de quelle
  partie il s'agit. Rendu dans le navigateur, ouvert dans un onglet.

  Polices de base du PDF (Times, Helvetica) : elles couvrent le français et
  n'ont rien à charger. Importé dynamiquement par la table, pour que la
  bibliothèque ne pèse pas sur la page tant qu'on ne lit pas.
*/
export interface StoryStrings {
  kicker: string;
  character: string;
  act: string;
  scenes: string;
  generated: string;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 64,
    paddingBottom: 72,
    paddingHorizontal: 64,
    fontFamily: "Times-Roman",
    fontSize: 11.5,
    lineHeight: 1.55,
    color: "#1a1a1a",
  },
  kicker: {
    fontFamily: "Helvetica",
    fontSize: 8.5,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#6b6b6b",
  },
  title: { fontFamily: "Times-Bold", fontSize: 26, lineHeight: 1.15, marginTop: 8 },
  world: { fontFamily: "Times-Italic", fontSize: 13, color: "#444", marginTop: 4 },
  meta: {
    marginTop: 18,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: "#bbb",
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#555",
  },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  scenes: { marginTop: 28 },
  scene: { marginBottom: 16 },
  paragraph: { textAlign: "justify", marginBottom: 6 },
  rule: { borderTopWidth: 0.5, borderTopColor: "#ccc", marginBottom: 16, width: 48 },
  /*
    Un Text fixe par coin, comme la documentation de react-pdf le montre : un
    View absolu et fixe qui les porterait tous deux ne se rend pas.
  */
  footerLeft: {
    position: "absolute",
    bottom: 36,
    left: 64,
    fontFamily: "Helvetica",
    fontSize: 8.5,
    color: "#777",
  },
  // Sans `left`, un bloc absolu n'a pas de largeur et son texte ne se rend pas.
  footerRight: {
    position: "absolute",
    bottom: 36,
    left: 64,
    right: 64,
    textAlign: "right",
    fontFamily: "Helvetica",
    fontSize: 8.5,
    color: "#777",
  },
});

// Les scènes : ce que le meneur a raconté, hors apartés.
export function scenesOf(messages: TurnMessage[]): string[] {
  return messages
    .filter((message) => message.role === "assistant" && message.request !== "ask")
    .map((message) => message.content.trim())
    .filter(Boolean);
}

function paragraphsOf(scene: string): string[] {
  return scene
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

export function StoryDocument({
  world,
  scenes,
  strings,
  generatedOn,
}: {
  world: WorldView;
  scenes: string[];
  strings: StoryStrings;
  generatedOn: string;
}) {
  const title = world.story.title ?? world.name;

  return (
    <Document title={title} author="OdyssAI" language="fr">
      <Page size="A4" style={styles.page}>
        <View>
          <Text style={styles.kicker}>{strings.kicker}</Text>
          <Text style={styles.title}>{title}</Text>
          {world.story.title ? <Text style={styles.world}>{world.name}</Text> : null}
        </View>

        <View style={styles.meta}>
          <View style={styles.metaRow}>
            <Text>{strings.character}</Text>
            <Text>
              {world.character.name} · {world.character.gender} · {world.character.age}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text>{strings.act}</Text>
            <Text>{strings.scenes}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text>{strings.generated}</Text>
            <Text>{generatedOn}</Text>
          </View>
        </View>

        <View style={styles.scenes}>
          {scenes.map((scene, index) => (
            <View key={index} style={styles.scene}>
              {index > 0 ? <View style={styles.rule} /> : null}
              {paragraphsOf(scene).map((paragraph, rank) => (
                <Text key={rank} style={styles.paragraph}>
                  {paragraph}
                </Text>
              ))}
            </View>
          ))}
        </View>

        <Text style={styles.footerLeft} fixed>
          OdyssAI · {world.name}
        </Text>
        <Text
          style={styles.footerRight}
          fixed
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

export async function renderStoryPdf(options: {
  world: WorldView;
  messages: TurnMessage[];
  strings: StoryStrings;
  generatedOn: string;
}): Promise<Blob> {
  const { world, messages, strings, generatedOn } = options;

  return pdf(
    <StoryDocument
      world={world}
      scenes={scenesOf(messages)}
      strings={strings}
      generatedOn={generatedOn}
    />,
  ).toBlob();
}
