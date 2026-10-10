# Content

What the site and the agent say about the owner: the CV, the projects, the posts and the knowledge base behind every CV claim, owned by the `content` module of `api`.

## Language

**Content**:
Anything the API serves that the owner writes and publishes after the site is built: profile, experience items, projects, posts, skills, CV bullets and knowledge entries.
_Avoid_: dynamic entries, dynamic content

**UI string**:
A fixed piece of interface text that ships with the site build, one per key and locale.
_Avoid_: static content, static entries

**Required locale**:
A locale an item must be published in before it can be published at all: Spanish and English.
_Avoid_: main language

**Optional locale**:
A locale an item may be published in later without blocking anything: German.
_Avoid_: secondary language

**Revision**:
An immutable snapshot of an item's text, created by every save; what the public sees is the revision a locale points to.
_Avoid_: version, draft copy

**Machine-translated revision**:
A revision drafted by a translation model instead of the owner; it is always a draft until the owner publishes or approves it.
_Avoid_: auto-translation, AI version

**CV bullet**:
One short, ordered claim under an experience item or project, translated per locale; the summary layer.
_Avoid_: highlight, achievement

**Knowledge entry**:
One detailed, English-only account of a piece of the owner's work that backs a CV bullet with evidence; the evidence layer.
_Avoid_: post, article, KB item

**Approval**:
The owner's decision that one specific revision of a knowledge entry is public, recorded with its checklist answers.
_Avoid_: approved flag, publish (for entries)
