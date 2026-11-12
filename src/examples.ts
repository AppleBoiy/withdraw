export const EXAMPLES: Record<string, string> = {
  'Knowledge-graph extraction': `## 1. From raw text to triples
Raw documents: doc icon:file-text
Chunks: data
Entity + relation extractor: llm icon:sparkles
Triples: data
Raw documents -> Cleaner
---
Cleaner -> Chunker -> Chunks
---
Chunks -> Entity + relation extractor: prompt per chunk
---
Entity + relation extractor -> Triples: (subject, relation, object)

## 2. Cleaning the graph
direction: right
Triples: data
Graph DB: db icon:neo4j
Triples -> Entity resolution: merge aliases
---
Entity resolution -> Schema validation
---
Schema validation -> Graph DB: upsert
Schema validation ..> Review queue: low confidence
Review queue: queue

## 3. Example output
Marie Curie: entity
Polonium: entity
Pierre Curie: entity
Marie Curie -> Polonium: discovered
---
Marie Curie -> Pierre Curie: married to
---
Pierre Curie -> Polonium: co-discovered
`,

  'System architecture': `## Chatbot architecture
User: user icon:user
Web app: client icon:react
API gateway: icon:nginx
Chat service: icon:fastapi
LLM: llm icon:anthropic
Vector DB: db icon:database
Postgres: db icon:postgresql
User -> Web app -> API gateway
API gateway -> Chat service: /chat
---
Chat service -> Retriever: query
Retriever -> Vector DB: top-k
---
Chat service -> LLM: prompt + context
---
Chat service -> Postgres: history
Chat service ..> Event queue: analytics
Event queue: queue icon:apachekafka
`,

  'Deployment plan': `## Deployment
direction: down
GitHub: external icon:github
CI pipeline: icon:githubactions
Container registry: store icon:docker
Kubernetes cluster: cloud icon:kubernetes
GitHub -> CI pipeline: push to main
CI pipeline -> Container registry: docker image
CI pipeline -> Staging: deploy
Staging -> Smoke tests
Smoke tests -> Production: manual approve
Production -> Kubernetes cluster
Production ..> Monitoring: metrics + logs
Monitoring: external icon:grafana
`,
}
