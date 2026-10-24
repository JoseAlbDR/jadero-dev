/**
 * One page of each type in each locale, on the stub content API's fixtures (`e2e/stub/`): the
 * localized pathnames of `routing.pathnames` with a fixture's slug or id. Specs that check every
 * page type (CSP, JavaScript budget) loop over this list.
 */
export const PAGE_TYPES = {
  en: {
    home: "/en",
    experience: "/en/experience",
    projects: "/en/projects",
    project: "/en/projects/message-relay",
    blog: "/en/blog",
    post: "/en/blog/why-an-outbox",
    journal: "/en/journal",
    journalPost: "/en/journal/the-content-domain",
    stack: "/en/stack",
    work: "/en/work",
    workEntry: "/en/work/kb-outbox-relay",
  },
  es: {
    home: "/es",
    experience: "/es/experiencia",
    projects: "/es/proyectos",
    project: "/es/proyectos/relay-de-mensajes",
    blog: "/es/blog",
    post: "/es/blog/por-que-un-outbox",
    journal: "/es/journal",
    journalPost: "/es/journal/el-dominio-de-contenido",
    stack: "/es/stack",
    work: "/es/trabajo",
    workEntry: "/es/trabajo/kb-outbox-relay",
  },
  de: {
    home: "/de",
    experience: "/de/erfahrung",
    projects: "/de/projekte",
    project: "/de/projekte/nachrichten-relay",
    blog: "/de/blog",
    post: "/de/blog/warum-ein-outbox",
    journal: "/de/journal",
    journalPost: "/de/journal/the-content-domain",
    stack: "/de/stack",
    work: "/de/arbeit",
    workEntry: "/de/arbeit/kb-outbox-relay",
  },
} as const;
