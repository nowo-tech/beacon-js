# Frameworks

| Framework | Package                     | Status          |
| --------- | --------------------------- | --------------- |
| Express   | `@nowo-tech/beacon-express` | 0.1             |
| React     | `@nowo-tech/beacon-react`   | planned for 0.2 |
| Vue       | `@nowo-tech/beacon-vue`     | planned for 0.2 |
| Angular   | `@nowo-tech/beacon-angular` | planned for 0.2 |
| Svelte    | `@nowo-tech/beacon-svelte`  | planned for 0.2 |
| Fastify   | `@nowo-tech/beacon-fastify` | planned for 0.2 |
| NestJS    | `@nowo-tech/beacon-nestjs`  | planned for 0.2 |
| Next.js   | `@nowo-tech/beacon-next`    | planned for 0.2 |

Until an adapter exists, `init` from `@nowo-tech/beacon-browser` or `@nowo-tech/beacon-node` plus the framework's own
error hook (calling `captureException`) works with any framework.
