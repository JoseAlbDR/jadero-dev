import { Module } from "@nestjs/common";
import { ApiWorkerConfig } from "../../config/api-config.js";
import { RelayModule } from "../relay/index.js";
import { HttpWebCache } from "./http-web-cache.js";
import { RevalidationConsumer } from "./revalidation.consumer.js";
import { RevalidationService } from "./revalidation.service.js";
import { RevalidationInbox } from "./revalidation-inbox.js";
import { WebCache } from "./web-cache.js";

/**
 * `api-worker`'s revalidation (ADR-003: a layered module; WP-14 D4 to D6): the consumer on
 * `api.revalidate`, its service, the inbox repository and the signed HTTP adapter behind the
 * `WebCache` port. The bus comes from `RelayModule`, the pool from the global `DatabaseModule`.
 */
@Module({
  imports: [RelayModule],
  providers: [
    {
      provide: WebCache,
      useFactory: (config: ApiWorkerConfig) =>
        new HttpWebCache({ url: config.webRevalidateUrl, secret: config.revalidateSecret }),
      inject: [ApiWorkerConfig],
    },
    RevalidationInbox,
    RevalidationService,
    RevalidationConsumer,
  ],
})
export class RevalidationModule {}
