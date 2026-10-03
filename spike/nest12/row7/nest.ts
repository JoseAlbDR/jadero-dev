import "reflect-metadata";
import { Injectable, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { buildGraph } from "./graph.js";

/** A Nest provider that owns the compiled graph. */
@Injectable()
export class AgentService {
  private readonly graph = buildGraph();

  /** Runs the graph for one question. */
  ask(question: string): Promise<unknown> {
    return this.graph.invoke({ question });
  }
}

@Module({ providers: [AgentService] })
export class AgentModule {}

const ctx = await NestFactory.createApplicationContext(AgentModule, { logger: false });
console.log("inside Nest provider ->", JSON.stringify(await ctx.get(AgentService).ask("hello?")));
await ctx.close();
