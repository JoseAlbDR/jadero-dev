import type { ContentSeedItem } from "../modules/content/index.js";

// Placeholder content for `db:seed` (WP-12 Q2 A): public-level text only, placeholder names, no
// employer, client or internal system names (ADR-031, AGENTS.md section 7). Every item has a fixed
// id, which is what makes the seed idempotent: an id already stored is skipped. es and en for
// everything; de on some items only, so the missing-German warning (D-20) shows up. Parents come
// before their CV bullets, the bullet before the entry that names it.

const PROFILE = "01990000-0000-7000-8000-000000000001";
const EXPERIENCE_CURRENT = "01990000-0000-7000-8000-000000000101";
const EXPERIENCE_FIRST = "01990000-0000-7000-8000-000000000102";
const PROJECT_CASE_STUDY = "01990000-0000-7000-8000-000000000201";
const PROJECT_SMALL = "01990000-0000-7000-8000-000000000202";
const POST_FIRST = "01990000-0000-7000-8000-000000000301";
const SKILL_BACKEND = "01990000-0000-7000-8000-000000000401";
const SKILL_TESTING = "01990000-0000-7000-8000-000000000402";

/** The placeholder content, in the order it is seeded. */
export const contentSeed: readonly ContentSeedItem[] = [
  {
    type: "profile",
    id: PROFILE,
    documents: {
      es: {
        name: "Alex Ejemplo",
        headline: "Ingeniero de backend",
        summary: "Texto de ejemplo para el perfil. Se sustituye con el contenido real.",
        links: [
          { kind: "website", url: "https://example.com" },
          { kind: "email", url: "mailto:hello@example.com" },
        ],
      },
      en: {
        name: "Alex Example",
        headline: "Backend engineer",
        summary: "Placeholder text for the profile. Real content replaces it.",
        links: [
          { kind: "website", url: "https://example.com" },
          { kind: "email", url: "mailto:hello@example.com" },
        ],
      },
      de: {
        name: "Alex Beispiel",
        headline: "Backend-Entwickler",
        summary: "Platzhaltertext für das Profil. Echte Inhalte ersetzen ihn.",
        links: [
          { kind: "website", url: "https://example.com" },
          { kind: "email", url: "mailto:hello@example.com" },
        ],
      },
    },
  },
  {
    type: "experience-item",
    id: EXPERIENCE_CURRENT,
    sortOrder: 1,
    documents: {
      es: {
        organization: "Empresa de ejemplo",
        role: "Ingeniero de backend",
        period: { from: "2024-01", to: null },
        locationType: "remote",
        stackTags: ["TypeScript", "NestJS", "PostgreSQL"],
      },
      en: {
        organization: "Example Company",
        role: "Backend engineer",
        period: { from: "2024-01", to: null },
        locationType: "remote",
        stackTags: ["TypeScript", "NestJS", "PostgreSQL"],
      },
      de: {
        organization: "Beispielfirma",
        role: "Backend-Entwickler",
        period: { from: "2024-01", to: null },
        locationType: "remote",
        stackTags: ["TypeScript", "NestJS", "PostgreSQL"],
      },
    },
  },
  {
    type: "experience-item",
    id: EXPERIENCE_FIRST,
    sortOrder: 2,
    documents: {
      es: {
        organization: "Estudio de ejemplo",
        role: "Desarrollador",
        period: { from: "2022-03", to: "2023-12" },
        locationType: "onsite",
        stackTags: ["JavaScript"],
      },
      en: {
        organization: "Example Studio",
        role: "Developer",
        period: { from: "2022-03", to: "2023-12" },
        locationType: "onsite",
        stackTags: ["JavaScript"],
      },
    },
  },
  {
    type: "project",
    id: PROJECT_CASE_STUDY,
    slug: "sample-case-study",
    kind: "case_study",
    featured: true,
    sortOrder: 1,
    documents: {
      es: {
        slug: "caso-de-ejemplo",
        title: "Caso de ejemplo",
        summary: "Un caso de estudio de ejemplo.",
        body: "## Problema\n\nTexto de ejemplo.",
        stackTags: ["NestJS", "RabbitMQ"],
        repoUrl: "https://github.com/example/sample",
        demoUrl: null,
      },
      en: {
        slug: "sample-case-study",
        title: "Sample case study",
        summary: "A placeholder case study.",
        body: "## Problem\n\nPlaceholder text.",
        stackTags: ["NestJS", "RabbitMQ"],
        repoUrl: "https://github.com/example/sample",
        demoUrl: null,
      },
      de: {
        slug: "beispiel-fallstudie",
        title: "Beispiel-Fallstudie",
        summary: "Eine Platzhalter-Fallstudie.",
        body: "## Problem\n\nPlatzhaltertext.",
        stackTags: ["NestJS", "RabbitMQ"],
        repoUrl: "https://github.com/example/sample",
        demoUrl: null,
      },
    },
  },
  {
    type: "project",
    id: PROJECT_SMALL,
    slug: "sample-project",
    kind: "project",
    featured: false,
    sortOrder: 2,
    documents: {
      es: {
        slug: "proyecto-de-ejemplo",
        title: "Proyecto de ejemplo",
        summary: "Un proyecto pequeño de ejemplo.",
        body: "Texto de ejemplo.",
        stackTags: ["TypeScript"],
        repoUrl: null,
        demoUrl: null,
      },
      en: {
        slug: "sample-project",
        title: "Sample project",
        summary: "A small placeholder project.",
        body: "Placeholder text.",
        stackTags: ["TypeScript"],
        repoUrl: null,
        demoUrl: null,
      },
    },
  },
  {
    type: "post",
    id: POST_FIRST,
    slug: "hello-world",
    documents: {
      es: {
        slug: "hola-mundo",
        title: "Hola, mundo",
        excerpt: "Una entrada de ejemplo.",
        body: "Texto de ejemplo.",
        tags: ["ejemplo"],
      },
      en: {
        slug: "hello-world",
        title: "Hello, world",
        excerpt: "A placeholder post.",
        body: "Placeholder text.",
        tags: ["example"],
      },
    },
  },
  {
    type: "skill",
    id: SKILL_BACKEND,
    sortOrder: 1,
    documents: {
      es: { name: "NestJS", category: "Backend", projectSlugs: ["sample-case-study"] },
      en: { name: "NestJS", category: "Backend", projectSlugs: ["sample-case-study"] },
      de: { name: "NestJS", category: "Backend", projectSlugs: ["sample-case-study"] },
    },
  },
  {
    type: "skill",
    id: SKILL_TESTING,
    sortOrder: 2,
    documents: {
      es: { name: "Testcontainers", category: "Pruebas", projectSlugs: [] },
      en: { name: "Testcontainers", category: "Testing", projectSlugs: [] },
    },
  },
  {
    type: "cv-bullet",
    id: "sample-backend-1",
    parent: { kind: "experience-item", experienceItemId: EXPERIENCE_CURRENT },
    sortOrder: 1,
    importance: 1,
    documents: {
      es: { text: "Construyó un servicio de ejemplo con una cola de mensajes." },
      en: { text: "Built a sample service with a message queue." },
      de: { text: "Baute einen Beispieldienst mit einer Nachrichtenwarteschlange." },
    },
  },
  {
    type: "cv-bullet",
    id: "sample-backend-2",
    parent: { kind: "experience-item", experienceItemId: EXPERIENCE_CURRENT },
    sortOrder: 2,
    importance: 2,
    documents: {
      es: { text: "Escribió pruebas de integración de ejemplo." },
      en: { text: "Wrote sample integration tests." },
    },
  },
  {
    type: "cv-bullet",
    id: "sample-project-1",
    parent: { kind: "project", projectId: PROJECT_CASE_STUDY },
    sortOrder: 1,
    importance: 3,
    documents: {
      es: { text: "Diseñó el caso de ejemplo." },
      en: { text: "Designed the sample case study." },
    },
  },
  {
    type: "knowledge-entry",
    id: "kb-sample-message-queue",
    document: {
      title: "A sample message queue",
      type: "feature",
      domain: "messaging",
      period: { from: "2024-02", to: "2024-04" },
      role: "sole author",
      sections: [
        { key: "summary", body: "Placeholder summary of a sample feature." },
        { key: "problem", body: "Placeholder problem statement." },
        { key: "whatHeBuilt", body: "Placeholder description of what was built." },
      ],
      questions: ["How does the sample queue retry?"],
      stack: ["NestJS", "RabbitMQ"],
      patterns: ["outbox"],
      related: [],
      cvBullet: "sample-backend-1",
      indexable: true,
    },
    provenance: {
      sources: ["placeholder notes"],
      conflicts: "",
      publicNames: [],
      confidence: "high",
    },
  },
];
